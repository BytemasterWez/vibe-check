import XCTest
@testable import MagLab

final class ScoringTests: XCTestCase {

    private let config = ScoringConfig.current
    private let scorer = RuleBasedAnomalyScorer()

    // MARK: - Helpers

    /// A clean walking sample: good GPS, stable motion.
    private func makeSample(
        magTotal: Double?,
        latitude: Double? = 51.5,
        longitude: Double? = -0.12,
        accuracy: Double? = 5,
        speed: Double? = 1.3,
        gpsQuality: Double = 1.0,
        motionQuality: Double = 0.9
    ) -> SensorSample {
        SensorSample(
            surveyId: UUID(),
            runId: UUID(),
            latitude: latitude,
            longitude: longitude,
            horizontalAccuracyM: accuracy,
            speedMps: speed,
            magTotal_uT: magTotal,
            gpsQualityScore: gpsQuality,
            motionQualityScore: motionQuality
        )
    }

    /// History of quiet background samples at `background` µT.
    private func quietHistory(count: Int, background: Double = 50) -> [SensorSample] {
        (0..<count).map { _ in makeSample(magTotal: background) }
    }

    // MARK: - Magnetic total

    func testMagneticTotalCalculation() {
        XCTAssertEqual(SensorSample.magneticTotal(x: 3, y: 4, z: 0), 5, accuracy: 1e-9)
        XCTAssertEqual(SensorSample.magneticTotal(x: 1, y: 2, z: 2), 3, accuracy: 1e-9)
        XCTAssertEqual(SensorSample.magneticTotal(x: 0, y: 0, z: 0), 0, accuracy: 1e-9)
        XCTAssertEqual(SensorSample.magneticTotal(x: -3, y: -4, z: 0), 5, accuracy: 1e-9)
    }

    // MARK: - Rolling baseline

    func testRollingMedianOddCount() {
        XCTAssertEqual(RollingBaseline.median([3, 1, 2]), 2)
    }

    func testRollingMedianEvenCount() {
        XCTAssertEqual(RollingBaseline.median([1, 2, 3, 4])!, 2.5, accuracy: 1e-9)
    }

    func testRollingMedianEmpty() {
        XCTAssertNil(RollingBaseline.median([]))
    }

    func testMedianResistsSpikes() {
        // One giant spike must not drag the baseline.
        var values = Array(repeating: 50.0, count: 20)
        values.append(500)
        XCTAssertEqual(RollingBaseline.median(values)!, 50, accuracy: 1e-9)
    }

    func testTrimmedMean() {
        let values = [1.0, 50, 50, 50, 50, 50, 50, 50, 50, 1000]
        // 10% trim drops the 1 and the 1000.
        XCTAssertEqual(RollingBaseline.trimmedMean(values, trimFraction: 0.1)!, 50, accuracy: 1e-9)
    }

    // MARK: - Residual

    func testResidualCalculation() {
        let history = quietHistory(count: config.minimumBaselineSamples, background: 50)
        let sample = makeSample(magTotal: 57)
        let result = scorer.score(sample: sample, recentSamples: history)
        XCTAssertEqual(result.localBaseline_uT!, 50, accuracy: 1e-9)
        XCTAssertEqual(result.localResidual_uT!, 7, accuracy: 1e-9)
    }

    // MARK: - Quality scores

    func testGpsQualityScore() {
        XCTAssertEqual(GpsQuality.score(horizontalAccuracyM: 3), 1.0, accuracy: 1e-9)
        XCTAssertEqual(GpsQuality.score(horizontalAccuracyM: 5), 1.0, accuracy: 1e-9)
        XCTAssertEqual(GpsQuality.score(horizontalAccuracyM: 30), 0.1, accuracy: 1e-9)
        XCTAssertEqual(GpsQuality.score(horizontalAccuracyM: 17.5), 0.55, accuracy: 1e-9)
        XCTAssertEqual(GpsQuality.score(horizontalAccuracyM: nil), 0)
        XCTAssertEqual(GpsQuality.score(horizontalAccuracyM: -1), 0)
        // Stale fix halves the score.
        XCTAssertEqual(GpsQuality.score(horizontalAccuracyM: 3, fixAgeSeconds: 10), 0.5, accuracy: 1e-9)
    }

    func testMotionQualityScore() {
        XCTAssertEqual(MotionQuality.score(accelStdDev: 0, rotationRateMagnitude: 0), 1.0, accuracy: 1e-9)
        XCTAssertEqual(MotionQuality.score(accelStdDev: 10, rotationRateMagnitude: 10), 0, accuracy: 1e-9)
        let steady = MotionQuality.score(accelStdDev: 0.05, rotationRateMagnitude: 0.2)
        let shaky = MotionQuality.score(accelStdDev: 0.6, rotationRateMagnitude: 2.5)
        XCTAssertGreaterThan(steady, shaky)
    }

    // MARK: - Score thresholds

    func testAnomalyScoreThresholdBands() {
        // < 2 µT residual: low (0–20)
        XCTAssertEqual(RuleBasedAnomalyScorer.rawScore(forResidualMagnitude: 1, config: config), 10, accuracy: 1e-9)
        // 2–5 µT: mild (20–50)
        XCTAssertEqual(RuleBasedAnomalyScorer.rawScore(forResidualMagnitude: 2, config: config), 20, accuracy: 1e-9)
        XCTAssertEqual(RuleBasedAnomalyScorer.rawScore(forResidualMagnitude: 3.5, config: config), 35, accuracy: 1e-9)
        // 5–15 µT: moderate (50–80)
        XCTAssertEqual(RuleBasedAnomalyScorer.rawScore(forResidualMagnitude: 5, config: config), 50, accuracy: 1e-9)
        XCTAssertEqual(RuleBasedAnomalyScorer.rawScore(forResidualMagnitude: 10, config: config), 65, accuracy: 1e-9)
        // > 15 µT: strong (80–100), capped
        XCTAssertEqual(RuleBasedAnomalyScorer.rawScore(forResidualMagnitude: 15, config: config), 80, accuracy: 1e-9)
        XCTAssertEqual(RuleBasedAnomalyScorer.rawScore(forResidualMagnitude: 1000, config: config), 100, accuracy: 1e-9)
    }

    func testStrongResidualIncreasesScore() {
        // Sustained elevation: recent history is already elevated, so the
        // strong residual is NOT treated as a single spike.
        var history = quietHistory(count: config.minimumBaselineSamples, background: 50)
        history.append(contentsOf: quietHistory(count: config.spikeNeighborCount, background: 62))
        let result = scorer.score(sample: makeSample(magTotal: 66), recentSamples: history)
        XCTAssertGreaterThanOrEqual(result.anomalyScore, 60)
        XCTAssertFalse(result.qualityFlags.contains(QualityFlag.singleSampleSpike.rawValue))
        XCTAssertEqual(result.likelyClass, LikelyClass.likelyFerrousOrInfrastructure.rawValue)
    }

    func testModerateResidualIsPossibleLocalAnomaly() {
        var history = quietHistory(count: config.minimumBaselineSamples, background: 50)
        history.append(contentsOf: quietHistory(count: config.spikeNeighborCount, background: 56))
        let result = scorer.score(sample: makeSample(magTotal: 57), recentSamples: history)
        XCTAssertEqual(result.likelyClass, LikelyClass.possibleLocalAnomaly.rawValue)
    }

    func testQuietBackgroundIsNormal() {
        let history = quietHistory(count: config.minimumBaselineSamples)
        let result = scorer.score(sample: makeSample(magTotal: 50.5), recentSamples: history)
        XCTAssertLessThan(result.anomalyScore, 20)
        XCTAssertEqual(result.likelyClass, LikelyClass.normalBackground.rawValue)
        XCTAssertTrue(result.qualityFlags.isEmpty)
    }

    // MARK: - Single spike penalty

    func testSingleSpikePenalty() {
        let history = quietHistory(count: config.minimumBaselineSamples, background: 50)

        // Spike out of quiet background...
        let spike = scorer.score(sample: makeSample(magTotal: 66), recentSamples: history)
        XCTAssertTrue(spike.qualityFlags.contains(QualityFlag.singleSampleSpike.rawValue))
        XCTAssertEqual(spike.likelyClass, LikelyClass.likelyMotionOrPhoneNoise.rawValue)

        // ...must score lower and be less confident than the same residual
        // arriving after sustained elevation.
        var elevatedHistory = history
        elevatedHistory.append(contentsOf: quietHistory(count: config.spikeNeighborCount, background: 62))
        let sustained = scorer.score(sample: makeSample(magTotal: 66), recentSamples: elevatedHistory)
        XCTAssertLessThan(spike.anomalyScore, sustained.anomalyScore)
        XCTAssertLessThan(spike.confidence, sustained.confidence)
    }

    // MARK: - Confidence penalties

    func testPoorGpsReducesConfidence() {
        let history = quietHistory(count: config.minimumBaselineSamples)
        let good = scorer.score(sample: makeSample(magTotal: 53), recentSamples: history)
        let poor = scorer.score(
            sample: makeSample(magTotal: 53, accuracy: 25),
            recentSamples: history
        )
        XCTAssertLessThan(poor.confidence, good.confidence)
        XCTAssertTrue(poor.qualityFlags.contains(QualityFlag.gpsAccuracyPoor.rawValue))
    }

    func testMissingGpsReducesConfidence() {
        let history = quietHistory(count: config.minimumBaselineSamples)
        let result = scorer.score(
            sample: makeSample(magTotal: 53, latitude: nil, longitude: nil, accuracy: nil),
            recentSamples: history
        )
        XCTAssertTrue(result.qualityFlags.contains(QualityFlag.gpsMissing.rawValue))
        XCTAssertLessThanOrEqual(result.confidence, config.baseConfidence - config.penaltyGpsMissing + 1e-9)
    }

    func testMotionInstabilityReducesConfidence() {
        let history = quietHistory(count: config.minimumBaselineSamples)
        let unstable = scorer.score(
            sample: makeSample(magTotal: 53, motionQuality: 0.1),
            recentSamples: history
        )
        let stable = scorer.score(sample: makeSample(magTotal: 53), recentSamples: history)
        XCTAssertLessThan(unstable.confidence, stable.confidence)
        XCTAssertTrue(unstable.qualityFlags.contains(QualityFlag.motionUnstable.rawValue))
    }

    func testExcessSpeedReducesConfidence() {
        let history = quietHistory(count: config.minimumBaselineSamples)
        let result = scorer.score(
            sample: makeSample(magTotal: 53, speed: 6.0),
            recentSamples: history
        )
        XCTAssertTrue(result.qualityFlags.contains(QualityFlag.speedTooHigh.rawValue))
    }

    // MARK: - Degenerate inputs

    func testInsufficientBaseline() {
        let history = quietHistory(count: config.minimumBaselineSamples - 1)
        let result = scorer.score(sample: makeSample(magTotal: 80), recentSamples: history)
        XCTAssertEqual(result.anomalyScore, 0)
        XCTAssertEqual(result.likelyClass, LikelyClass.insufficientData.rawValue)
        XCTAssertTrue(result.qualityFlags.contains(QualityFlag.insufficientBaseline.rawValue))
    }

    func testMissingMagnetometer() {
        let history = quietHistory(count: config.minimumBaselineSamples)
        let result = scorer.score(sample: makeSample(magTotal: nil), recentSamples: history)
        XCTAssertEqual(result.anomalyScore, 0)
        XCTAssertEqual(result.confidence, 0)
        XCTAssertEqual(result.likelyClass, LikelyClass.insufficientData.rawValue)
        XCTAssertTrue(result.qualityFlags.contains(QualityFlag.magnetometerUnavailable.rawValue))
    }

    // MARK: - Core ML placeholder

    func testCoreMLScorerFallsBackToRules() {
        let coreML = CoreMLAnomalyScorer()
        XCTAssertFalse(coreML.isModelLoaded)
        let history = quietHistory(count: config.minimumBaselineSamples)
        let sample = makeSample(magTotal: 57)
        let ruleResult = scorer.score(sample: sample, recentSamples: history)
        let mlResult = coreML.score(sample: sample, recentSamples: history)
        XCTAssertEqual(mlResult.anomalyScore, ruleResult.anomalyScore, accuracy: 1e-9)
        XCTAssertEqual(mlResult.likelyClass, ruleResult.likelyClass)
    }
}
