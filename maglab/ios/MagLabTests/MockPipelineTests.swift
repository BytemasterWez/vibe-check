import XCTest
@testable import MagLab

/// End-to-end pipeline test over the deterministic mock walk: mock sensor
/// snapshots → fused samples → rule-based scorer, exactly as
/// RecordingEngine ticks, minus persistence and UI. This is the executable
/// version of the simulator acceptance check: baseline warms up on quiet
/// ground, the score rises past the anomaly threshold at a planted target,
/// and open ground between targets stays quiet.
final class MockPipelineTests: XCTestCase {

    private struct Step {
        let distanceM: Double
        let result: AnomalyResult
    }

    /// Simulate `seconds` of the mock walk at the configured sampling rate.
    private func runMockWalk(seconds: Double, config: ScoringConfig = .current) -> (steps: [Step], mock: MockSensorManager) {
        let mock = MockSensorManager()
        let scorer = RuleBasedAnomalyScorer(config: config)
        var recent: [SensorSample] = []
        var steps: [Step] = []

        let dt = 1.0 / config.samplingHz
        var t = 0.0
        while t <= seconds {
            let snapshot = mock.snapshot(elapsed: t)
            var magTotal: Double?
            if let x = snapshot.magX_uT, let y = snapshot.magY_uT, let z = snapshot.magZ_uT {
                magTotal = SensorSample.magneticTotal(x: x, y: y, z: z)
            }
            let sample = SensorSample(
                surveyId: UUID(),
                runId: UUID(),
                timestampUtc: snapshot.timestamp,
                latitude: snapshot.latitude,
                longitude: snapshot.longitude,
                horizontalAccuracyM: snapshot.horizontalAccuracyM,
                speedMps: snapshot.speedMps,
                magX_uT: snapshot.magX_uT,
                magY_uT: snapshot.magY_uT,
                magZ_uT: snapshot.magZ_uT,
                magTotal_uT: magTotal,
                gpsQualityScore: GpsQuality.score(horizontalAccuracyM: snapshot.horizontalAccuracyM),
                motionQualityScore: 0.9
            )
            let result = scorer.score(sample: sample, recentSamples: recent)
            sample.localBaseline_uT = result.localBaseline_uT
            sample.localResidual_uT = result.localResidual_uT
            sample.anomalyScore = result.anomalyScore

            recent.append(sample)
            if recent.count > config.baselineWindowSampleCount {
                recent.removeFirst()
            }
            steps.append(Step(distanceM: t * mock.walkSpeedMps, result: result))
            t += dt
        }
        return (steps, mock)
    }

    func testMockSnapshotsAreCompleteAndDeterministic() {
        let a = MockSensorManager().snapshot(elapsed: 12.5)
        let b = MockSensorManager().snapshot(elapsed: 12.5)

        // Every mock snapshot must carry GPS, magnetometer and barometer.
        XCTAssertNotNil(a.latitude)
        XCTAssertNotNil(a.longitude)
        XCTAssertNotNil(a.magX_uT)
        XCTAssertNotNil(a.magY_uT)
        XCTAssertNotNil(a.magZ_uT)
        XCTAssertNotNil(a.pressureHpa)
        XCTAssertTrue(a.isMockData)

        // Identical elapsed time ⇒ identical readings (repeatability
        // testing in Phase 6 depends on this).
        XCTAssertEqual(a.magX_uT!, b.magX_uT!, accuracy: 1e-12)
        XCTAssertEqual(a.longitude!, b.longitude!, accuracy: 1e-12)
    }

    func testBaselineWarmupThenScoring() {
        let config = ScoringConfig.current
        let (steps, _) = runMockWalk(seconds: 10, config: config)

        // Before enough history exists, the scorer must say so rather than
        // invent a score.
        let first = steps.first!.result
        XCTAssertEqual(first.likelyClass, LikelyClass.insufficientData.rawValue)
        XCTAssertTrue(first.qualityFlags.contains(QualityFlag.insufficientBaseline.rawValue))

        // Once warm, samples get real baselines near the mock background.
        let warm = steps.dropFirst(config.minimumBaselineSamples + 1)
        XCTAssertFalse(warm.isEmpty)
        for step in warm {
            XCTAssertNotNil(step.result.localBaseline_uT)
        }
    }

    func testMockTargetPassRaisesScoreAndOpenGroundStaysQuiet() {
        let config = ScoringConfig.current
        // 35 s ≈ 49 m: warm-up on quiet ground, a target pass at 20 m,
        // then open ground.
        let (steps, mock) = runMockWalk(seconds: 35, config: config)
        let target = mock.anomalySpacingM / 2 // 20 m

        let nearTarget = steps.filter { abs($0.distanceM - target) <= 3 }
        let openGround = steps.filter { $0.distanceM >= target + 15 && $0.distanceM <= target + 25 }
        XCTAssertFalse(nearTarget.isEmpty)
        XCTAssertFalse(openGround.isEmpty)

        // The planted 12 µT target must push the score past the anomaly
        // threshold, with usable confidence, without a spike flag (the bump
        // spans many consecutive samples).
        let peak = nearTarget.max(by: { $0.result.anomalyScore < $1.result.anomalyScore })!
        XCTAssertGreaterThanOrEqual(peak.result.anomalyScore, config.anomalyEventThreshold)
        XCTAssertGreaterThanOrEqual(peak.result.confidence, 0.5)
        XCTAssertFalse(peak.result.qualityFlags.contains(QualityFlag.singleSampleSpike.rawValue))

        // Open ground between targets must stay well below the threshold —
        // the open-grass-control requirement in mock form.
        let quietMax = openGround.map(\.result.anomalyScore).max()!
        XCTAssertLessThan(quietMax, 40)
    }
}
