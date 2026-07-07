import SwiftUI
import SwiftData

/// Survey Detail screen: setup summary, quality metrics, runs, markers,
/// and the entry point to a new recording. Map replay (Phase 4), export
/// (Phase 5), repeatability (Phase 6) and sync (Phase 7) are stubbed.
struct SurveyDetailView: View {
    @Environment(\.modelContext) private var modelContext

    let survey: Survey

    @State private var runs: [SurveyRun] = []
    @State private var markers: [SurveyMarker] = []
    @State private var stats = SurveySampleStats()

    var body: some View {
        List {
            Section("Setup") {
                row("Target type", TargetType(rawValue: survey.targetType)?.displayName ?? survey.targetType)
                row("Mount", MountPosition(rawValue: survey.mountPosition)?.displayName ?? survey.mountPosition)
                row("Pattern", SurveyPattern(rawValue: survey.surveyPattern)?.displayName ?? survey.surveyPattern)
                row("Signal module", SignalModuleOption(rawValue: survey.signalModule)?.displayName ?? survey.signalModule)
                row("Sharing", ShareSetting(rawValue: survey.shareSetting)?.displayName ?? survey.shareSetting)
                if !survey.operatorNotes.isEmpty { row("Operator notes", survey.operatorNotes) }
                if !survey.weatherNotes.isEmpty { row("Weather", survey.weatherNotes) }
                if !survey.contaminationNotes.isEmpty {
                    row("Contamination", survey.contaminationNotes.joined(separator: ", "))
                }
            }

            Section("Summary") {
                row("Runs", "\(runs.count)")
                row("Samples", "\(stats.sampleCount)")
                row("Median GPS accuracy", Format.meters(stats.medianGpsAccuracyM))
                row("Mean mag total", Format.microtesla(stats.meanMagTotal))
                row("Max mag total", Format.microtesla(stats.maxMagTotal))
                row("Max +residual", Format.microtesla(stats.maxPositiveResidual))
                row("Max −residual", Format.microtesla(stats.maxNegativeResidual))
                row("Max anomaly score", Format.score(stats.maxAnomalyScore))
                row("High-score samples (≥60)", "\(stats.highScoreSampleCount)")
                row("Mean motion quality", Format.quality(stats.meanMotionQuality))
                row("Mean GPS quality", Format.quality(stats.meanGpsQuality))
                row("Sync status", survey.syncStatus)
            }

            Section("Runs") {
                if runs.isEmpty {
                    Text("No runs recorded yet.").foregroundStyle(.secondary)
                }
                ForEach(runs) { run in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(run.startedAt.formatted(date: .abbreviated, time: .standard))
                            .font(.subheadline)
                        HStack(spacing: 12) {
                            Text("\(run.sampleCount) samples")
                            if let score = run.maxAnomalyScore {
                                Text("max score \(Format.score(score))")
                            }
                            Text(run.isComplete ? "complete" : "incomplete")
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                }
            }

            if !markers.isEmpty {
                Section("Markers") {
                    ForEach(markers) { marker in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(MarkerType(rawValue: marker.markerType)?.displayName ?? marker.markerType)
                                .font(.subheadline)
                            if !marker.note.isEmpty {
                                Text(marker.note).font(.caption)
                            }
                            Text(marker.timestampUtc.formatted(date: .omitted, time: .standard))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Section("Actions") {
                NavigationLink("Start Recording") {
                    LiveRecordingView(survey: survey)
                }
                Button("Duplicate survey setup") {
                    _ = SurveyStore.duplicateSetup(of: survey, in: modelContext)
                }
                Label("Map replay — Phase 4", systemImage: "map").foregroundStyle(.secondary)
                Label("Export CSV / GeoJSON — Phase 5", systemImage: "square.and.arrow.up").foregroundStyle(.secondary)
                Label("Repeatability — Phase 6", systemImage: "repeat").foregroundStyle(.secondary)
                Label("Backend sync — Phase 7", systemImage: "icloud.and.arrow.up").foregroundStyle(.secondary)
            }
        }
        .navigationTitle(survey.name)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: reload)
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
        }
    }

    private func reload() {
        runs = SurveyStore.runs(for: survey, in: modelContext)
        markers = SurveyStore.markers(for: survey, in: modelContext)
        stats = SurveySampleStats(samples: SurveyStore.samples(for: survey, in: modelContext))
    }
}

/// In-memory aggregate over a survey's samples for the summary section.
struct SurveySampleStats {
    var sampleCount = 0
    var medianGpsAccuracyM: Double?
    var meanMagTotal: Double?
    var maxMagTotal: Double?
    var maxPositiveResidual: Double?
    var maxNegativeResidual: Double?
    var maxAnomalyScore: Double?
    var highScoreSampleCount = 0
    var meanMotionQuality: Double?
    var meanGpsQuality: Double?

    init() {}

    init(samples: [SensorSample], highScoreThreshold: Double = ScoringConfig.current.anomalyEventThreshold) {
        sampleCount = samples.count
        guard !samples.isEmpty else { return }

        medianGpsAccuracyM = RollingBaseline.median(samples.compactMap(\.horizontalAccuracyM))

        let magTotals = samples.compactMap(\.magTotal_uT)
        if !magTotals.isEmpty {
            meanMagTotal = magTotals.reduce(0, +) / Double(magTotals.count)
            maxMagTotal = magTotals.max()
        }

        let residuals = samples.compactMap(\.localResidual_uT)
        maxPositiveResidual = residuals.filter { $0 > 0 }.max()
        maxNegativeResidual = residuals.filter { $0 < 0 }.min()

        maxAnomalyScore = samples.map(\.anomalyScore).max()
        highScoreSampleCount = samples.filter { $0.anomalyScore >= highScoreThreshold }.count
        meanMotionQuality = samples.map(\.motionQualityScore).reduce(0, +) / Double(samples.count)
        meanGpsQuality = samples.map(\.gpsQualityScore).reduce(0, +) / Double(samples.count)
    }
}
