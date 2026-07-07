import Foundation

/// v1 scorer: transparent, calibrated rules over the magnetic residual with
/// explicit confidence penalties. No machine learning involved — every score
/// can be explained from the config thresholds.
struct RuleBasedAnomalyScorer: AnomalyScoring {
    let config: ScoringConfig

    init(config: ScoringConfig = .current) {
        self.config = config
    }

    func score(sample: SensorSample, recentSamples: [SensorSample]) -> AnomalyResult {
        var flags: [String] = []

        // 1. Magnetometer must exist.
        guard let magTotal = sample.magTotal_uT else {
            flags.append(QualityFlag.magnetometerUnavailable.rawValue)
            return AnomalyResult(
                anomalyScore: 0,
                confidence: 0,
                likelyClass: LikelyClass.insufficientData.rawValue,
                qualityFlags: flags,
                localBaseline_uT: nil,
                localResidual_uT: nil
            )
        }

        // 2. Rolling baseline from recent history (median resists spikes).
        let history = recentSamples.suffix(config.baselineWindowSampleCount).compactMap { $0.magTotal_uT }
        guard history.count >= config.minimumBaselineSamples,
              let baseline = RollingBaseline.median(history) else {
            flags.append(QualityFlag.insufficientBaseline.rawValue)
            return AnomalyResult(
                anomalyScore: 0,
                confidence: 0.2,
                likelyClass: LikelyClass.insufficientData.rawValue,
                qualityFlags: flags,
                localBaseline_uT: nil,
                localResidual_uT: nil
            )
        }

        // 3. Residual and raw score.
        let residual = magTotal - baseline
        let magnitude = abs(residual)
        var score = Self.rawScore(forResidualMagnitude: magnitude, config: config)
        var confidence = config.baseConfidence

        // 4. Confidence penalties.
        if sample.latitude == nil || sample.longitude == nil {
            flags.append(QualityFlag.gpsMissing.rawValue)
            confidence -= config.penaltyGpsMissing
        } else if let accuracy = sample.horizontalAccuracyM,
                  accuracy < 0 || accuracy > config.poorGpsAccuracyM {
            flags.append(QualityFlag.gpsAccuracyPoor.rawValue)
            confidence -= config.penaltyGpsPoor
        }

        if sample.motionQualityScore < config.motionQualityFloor {
            flags.append(QualityFlag.motionUnstable.rawValue)
            confidence -= config.penaltyMotionUnstable
        }

        if let speed = sample.speedMps, speed > config.maxWalkingSpeedMps {
            flags.append(QualityFlag.speedTooHigh.rawValue)
            confidence -= config.penaltySpeedTooHigh
        }

        // 5. Single-sample spike: a strong residual whose immediate
        //    neighbours are quiet is contamination until proven otherwise.
        if Self.isSingleSampleSpike(
            residualMagnitude: magnitude,
            history: history,
            baseline: baseline,
            config: config
        ) {
            flags.append(QualityFlag.singleSampleSpike.rawValue)
            confidence -= config.penaltySingleSpike
            score *= config.spikeScoreMultiplier
        }

        confidence = min(max(confidence, 0), 1)
        score = min(max(score, 0), 100)

        let likelyClass = Self.classify(
            residualMagnitude: magnitude,
            flags: flags,
            config: config
        )

        return AnomalyResult(
            anomalyScore: score,
            confidence: confidence,
            likelyClass: likelyClass.rawValue,
            qualityFlags: flags,
            localBaseline_uT: baseline,
            localResidual_uT: residual
        )
    }

    // MARK: - Rules

    /// Piecewise-linear mapping of |residual| (µT) onto 0–100:
    ///   0 → mild (2 µT):        0–20   (low)
    ///   mild → moderate (5 µT): 20–50  (mild)
    ///   moderate → strong (15): 50–80  (moderate)
    ///   beyond strong:          80–100 (strong)
    static func rawScore(forResidualMagnitude magnitude: Double, config: ScoringConfig) -> Double {
        let mild = config.mildResidual_uT
        let moderate = config.moderateResidual_uT
        let strong = config.strongResidual_uT
        switch magnitude {
        case ..<mild:
            return magnitude / mild * 20
        case ..<moderate:
            return 20 + (magnitude - mild) / (moderate - mild) * 30
        case ..<strong:
            return 50 + (magnitude - moderate) / (strong - moderate) * 30
        default:
            return min(100, 80 + (magnitude - strong) / strong * 20)
        }
    }

    /// A residual at moderate strength or above counts as a spike when none
    /// of the immediately preceding samples were even mildly elevated.
    static func isSingleSampleSpike(
        residualMagnitude: Double,
        history: [Double],
        baseline: Double,
        config: ScoringConfig
    ) -> Bool {
        guard residualMagnitude >= config.moderateResidual_uT else { return false }
        let neighbours = history.suffix(config.spikeNeighborCount)
        guard !neighbours.isEmpty else { return true }
        return neighbours.allSatisfy { abs($0 - baseline) < config.mildResidual_uT }
    }

    static func classify(
        residualMagnitude: Double,
        flags: [String],
        config: ScoringConfig
    ) -> LikelyClass {
        let has = { (flag: QualityFlag) in flags.contains(flag.rawValue) }

        if residualMagnitude < config.moderateResidual_uT {
            return .normalBackground
        }
        if has(.singleSampleSpike) || has(.motionUnstable) || has(.speedTooHigh) {
            return .likelyMotionOrPhoneNoise
        }
        if has(.gpsMissing) || has(.gpsAccuracyPoor) {
            return .poorGpsQuality
        }
        if residualMagnitude >= config.strongResidual_uT {
            return .likelyFerrousOrInfrastructure
        }
        return .possibleLocalAnomaly
    }
}
