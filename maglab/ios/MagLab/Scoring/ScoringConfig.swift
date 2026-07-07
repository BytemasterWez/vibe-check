import Foundation

/// Tunable parameters for the rule-based scorer and (Phase 6) event
/// clustering. Versioned so exported data can record exactly which
/// configuration produced its scores.
struct ScoringConfig {
    /// Identifier written into survey package exports.
    static let version = "rule-based-v1"

    // Sampling
    var samplingHz: Double = 5

    // Rolling baseline
    /// How many recent samples feed the rolling baseline (~20 s at 5 Hz).
    var baselineWindowSampleCount: Int = 100
    /// Minimum history before residuals are trusted at all.
    var minimumBaselineSamples: Int = 25

    // Residual thresholds (µT), from the calibration table:
    //   < 2 low, 2–5 mild, 5–15 moderate, > 15 strong
    var mildResidual_uT: Double = 2
    var moderateResidual_uT: Double = 5
    var strongResidual_uT: Double = 15

    // Anomaly event clustering (used from Phase 6)
    var anomalyEventThreshold: Double = 60
    var highConfidenceThreshold: Double = 75
    var minimumClusterSamples: Int = 5

    // Quality limits
    var poorGpsAccuracyM: Double = 10
    var maxWalkingSpeedMps: Double = 2.5
    var motionQualityFloor: Double = 0.4
    var staleGpsMaxAgeSeconds: Double = 5

    // Single-spike detection: how many preceding samples must also be
    // elevated before a strong residual is trusted as more than a spike.
    var spikeNeighborCount: Int = 3

    // Confidence penalties
    var penaltyGpsMissing: Double = 0.30
    var penaltyGpsPoor: Double = 0.20
    var penaltyMotionUnstable: Double = 0.20
    var penaltySpeedTooHigh: Double = 0.15
    var penaltySingleSpike: Double = 0.35
    var penaltyOrientationUnstable: Double = 0.10
    /// Score multiplier applied to single-sample spikes.
    var spikeScoreMultiplier: Double = 0.6
    /// Confidence before any penalties.
    var baseConfidence: Double = 0.9

    static let current = ScoringConfig()
}
