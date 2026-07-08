import Foundation
import SwiftData

/// Drives a recording run: ticks at the configured sampling rate, fuses the
/// latest sensor snapshot into a SensorSample, scores it, persists it, and
/// publishes live values for the recording UI.
@MainActor
final class RecordingEngine: ObservableObject {

    enum RecordingState: String {
        case idle, recording, paused, stopped
    }

    // Live-published state for the recording screen.
    @Published private(set) var state: RecordingState = .idle
    @Published private(set) var elapsedSeconds: TimeInterval = 0
    @Published private(set) var sampleCount: Int = 0
    @Published private(set) var latestSample: SensorSample?
    @Published private(set) var warnings: [String] = []
    @Published private(set) var markerCount: Int = 0

    let sensors: SensorProviding
    private let scorer: AnomalyScoring
    private let config: ScoringConfig
    private let modelContext: ModelContext
    private var timer: Timer?

    private(set) var survey: Survey?
    private(set) var run: SurveyRun?

    // Scoring window and run aggregates.
    private var recentSamples: [SensorSample] = []
    private var recentAccelMagnitudes: [Double] = []
    private var gpsAccuracies: [Double] = []
    private var maxAnomalyScore: Double = 0
    private var samplesSinceSave = 0

    init(
        container: ModelContainer,
        sensors: SensorProviding,
        scorer: AnomalyScoring = RuleBasedAnomalyScorer(),
        config: ScoringConfig = .current
    ) {
        // The engine is @MainActor, so it can share the container's main
        // context — which is also what the views' @Query observes, so
        // recorded runs/samples/markers appear in the UI without relying
        // on cross-context change merging.
        self.modelContext = container.mainContext
        self.sensors = sensors
        self.scorer = scorer
        self.config = config
    }

    // MARK: - Lifecycle

    func start(survey: Survey) {
        guard state == .idle || state == .stopped else { return }
        self.survey = survey

        let run = SurveyRun(surveyId: survey.id)
        modelContext.insert(run)
        self.run = run

        recentSamples = []
        recentAccelMagnitudes = []
        gpsAccuracies = []
        maxAnomalyScore = 0
        sampleCount = 0
        elapsedSeconds = 0
        markerCount = 0
        latestSample = nil

        sensors.requestPermissions()
        sensors.start()
        state = .recording
        startTimer()
    }

    func pause() {
        guard state == .recording else { return }
        state = .paused
        stopTimer()
    }

    func resume() {
        guard state == .paused else { return }
        state = .recording
        startTimer()
    }

    func stopAndSave() {
        guard state == .recording || state == .paused else { return }
        stopTimer()
        sensors.stop()

        if let run {
            run.endedAt = Date()
            run.isComplete = true
            run.sampleCount = sampleCount
            run.medianGpsAccuracyM = RollingBaseline.median(gpsAccuracies)
            run.maxAnomalyScore = maxAnomalyScore
        }
        try? modelContext.save()
        state = .stopped
    }

    /// Discard the run if recording never really happened (0 samples).
    func discardIfEmpty() {
        guard let run, sampleCount == 0 else { return }
        modelContext.delete(run)
        try? modelContext.save()
        self.run = nil
    }

    // MARK: - Markers

    func addMarker(type: MarkerType, note: String) {
        guard let survey, let run else { return }
        let snapshot = sensors.latestSnapshot()
        let marker = SurveyMarker(
            surveyId: survey.id,
            runId: run.id,
            timestampUtc: Date(),
            latitude: snapshot.latitude,
            longitude: snapshot.longitude,
            markerType: type.rawValue,
            note: note
        )
        modelContext.insert(marker)
        try? modelContext.save()
        markerCount += 1
    }

    // MARK: - Sampling loop

    private func startTimer() {
        stopTimer()
        let interval = 1.0 / config.samplingHz
        let timer = Timer(timeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.tick()
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    private func tick() {
        guard state == .recording, let survey, let run else { return }
        let snapshot = sensors.latestSnapshot()
        let now = Date()
        elapsedSeconds += 1.0 / config.samplingHz

        // Motion quality from user-acceleration variance over ~2 s.
        if let accel = snapshot.userAccelMagnitude {
            recentAccelMagnitudes.append(accel)
            if recentAccelMagnitudes.count > Int(config.samplingHz * 2) {
                recentAccelMagnitudes.removeFirst()
            }
        }
        let accelStdDev = RollingBaseline.standardDeviation(recentAccelMagnitudes) ?? 0
        let motionQuality = snapshot.motionAvailable
            ? MotionQuality.score(
                accelStdDev: accelStdDev,
                rotationRateMagnitude: snapshot.rotationRateMagnitude ?? 0
            )
            : 0

        let gpsQuality = GpsQuality.score(
            horizontalAccuracyM: snapshot.horizontalAccuracyM,
            fixAgeSeconds: snapshot.gpsFixAgeSeconds(asOf: now),
            staleAfterSeconds: config.staleGpsMaxAgeSeconds
        )

        var magTotal: Double?
        if let x = snapshot.magX_uT, let y = snapshot.magY_uT, let z = snapshot.magZ_uT {
            magTotal = SensorSample.magneticTotal(x: x, y: y, z: z)
        }

        let sample = SensorSample(
            surveyId: survey.id,
            runId: run.id,
            timestampUtc: now,
            latitude: snapshot.latitude,
            longitude: snapshot.longitude,
            horizontalAccuracyM: snapshot.horizontalAccuracyM,
            altitudeM: snapshot.altitudeM,
            verticalAccuracyM: snapshot.verticalAccuracyM,
            speedMps: snapshot.speedMps,
            courseDeg: snapshot.courseDeg,
            magX_uT: snapshot.magX_uT,
            magY_uT: snapshot.magY_uT,
            magZ_uT: snapshot.magZ_uT,
            magTotal_uT: magTotal,
            accelX: snapshot.userAccelX,
            accelY: snapshot.userAccelY,
            accelZ: snapshot.userAccelZ,
            gyroX: snapshot.gyroX,
            gyroY: snapshot.gyroY,
            gyroZ: snapshot.gyroZ,
            pitch: snapshot.pitch,
            roll: snapshot.roll,
            yaw: snapshot.yaw,
            pressureHpa: snapshot.pressureHpa,
            relativeAltitudeM: snapshot.relativeAltitudeM,
            gpsQualityScore: gpsQuality,
            motionQualityScore: motionQuality
        )

        let result = scorer.score(sample: sample, recentSamples: recentSamples)
        sample.localBaseline_uT = result.localBaseline_uT
        sample.localResidual_uT = result.localResidual_uT
        sample.anomalyScore = result.anomalyScore
        sample.modelConfidence = result.confidence
        sample.likelyClass = result.likelyClass
        var flags = result.qualityFlags
        if let age = snapshot.gpsFixAgeSeconds(asOf: now), age > config.staleGpsMaxAgeSeconds {
            flags.append(QualityFlag.gpsStale.rawValue)
        }
        if !snapshot.barometerAvailable {
            flags.append(QualityFlag.barometerUnavailable.rawValue)
        }
        if snapshot.isMockData {
            flags.append(QualityFlag.mockSensorData.rawValue)
        }
        sample.qualityFlags = flags

        modelContext.insert(sample)

        // Aggregates + scoring window.
        recentSamples.append(sample)
        if recentSamples.count > config.baselineWindowSampleCount {
            recentSamples.removeFirst()
        }
        if let accuracy = snapshot.horizontalAccuracyM, accuracy >= 0 {
            gpsAccuracies.append(accuracy)
        }
        maxAnomalyScore = max(maxAnomalyScore, result.anomalyScore)
        sampleCount += 1
        latestSample = sample

        // Batch saves: every ~5 s of samples rather than every tick.
        samplesSinceSave += 1
        if samplesSinceSave >= Int(config.samplingHz * 5) {
            try? modelContext.save()
            samplesSinceSave = 0
        }

        warnings = Self.warnings(for: snapshot, sample: sample, config: config)
    }

    // MARK: - Warnings

    static func warnings(
        for snapshot: SensorSnapshot,
        sample: SensorSample,
        config: ScoringConfig
    ) -> [String] {
        var result: [String] = []
        if !snapshot.locationAuthorized && !snapshot.isMockData {
            result.append("Location permission missing")
        }
        if !snapshot.magnetometerAvailable {
            result.append("Magnetometer unavailable")
        }
        if !snapshot.motionAvailable && !snapshot.isMockData {
            result.append("Motion data unavailable")
        }
        let flags = sample.qualityFlags
        if flags.contains(QualityFlag.gpsMissing.rawValue) {
            result.append("No GPS fix")
        }
        if flags.contains(QualityFlag.gpsAccuracyPoor.rawValue)
            || flags.contains(QualityFlag.gpsStale.rawValue) {
            result.append("GPS accuracy poor")
        }
        if flags.contains(QualityFlag.motionUnstable.rawValue) {
            result.append("Device motion unstable")
        }
        if flags.contains(QualityFlag.speedTooHigh.rawValue) {
            result.append("Walking too fast for reliable readings")
        }
        if flags.contains(QualityFlag.insufficientBaseline.rawValue) {
            result.append("Too few samples for baseline — keep walking")
        }
        if flags.contains(QualityFlag.singleSampleSpike.rawValue) {
            result.append("Single spike — likely contamination, not proof")
        }
        if snapshot.isMockData {
            result.append("Mock sensor mode active")
        }
        return result
    }
}
