import Foundation

/// Output of scoring a single sample against recent history.
struct AnomalyResult {
    let anomalyScore: Double        // 0–100
    let confidence: Double          // 0–1
    let likelyClass: String         // LikelyClass raw value
    let qualityFlags: [String]      // QualityFlag raw values
    let localBaseline_uT: Double?
    let localResidual_uT: Double?
}

/// Scoring interface. `recentSamples` is the trailing window *before* the
/// sample being scored (oldest first). Implementations must never claim
/// geology, minerals, utilities or dig-safety — only anomaly likelihoods.
protocol AnomalyScoring {
    func score(sample: SensorSample, recentSamples: [SensorSample]) -> AnomalyResult
}
