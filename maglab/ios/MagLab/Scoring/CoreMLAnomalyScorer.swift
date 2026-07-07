import Foundation

/// Placeholder for the v2+ learned scorer. No model ships in v1 and nothing
/// may block on Core ML: until a compiled .mlmodelc is bundled and loaded,
/// every call falls through to the rule-based scorer.
///
/// Planned evolution (see docs/README.md, section "Model strategy"):
///   v2 — tabular classifier trained on labelled survey data
///   v3 — context-aware model with public geology/infrastructure layers
///   v4 — multi-signal model (mag + motion + barometer + road vibration)
struct CoreMLAnomalyScorer: AnomalyScoring {
    private let fallback: RuleBasedAnomalyScorer

    /// True once a Core ML model is actually loaded. Always false in v1.
    var isModelLoaded: Bool { false }

    init(config: ScoringConfig = .current) {
        self.fallback = RuleBasedAnomalyScorer(config: config)
    }

    func score(sample: SensorSample, recentSamples: [SensorSample]) -> AnomalyResult {
        // TODO(v2): load bundled .mlmodelc, build a feature vector from the
        // sample + recent window, and blend model output with rule-based
        // confidence penalties. Until then: rules only.
        fallback.score(sample: sample, recentSamples: recentSamples)
    }
}
