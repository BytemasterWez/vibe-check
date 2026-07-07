import Foundation

/// Robust rolling-baseline estimators for the local magnetic background.
/// Median is the default because a walking survey regularly passes brief
/// ferrous spikes that must not drag the baseline with them.
enum RollingBaseline {
    /// Median of the values, or nil when empty.
    static func median(_ values: [Double]) -> Double? {
        guard !values.isEmpty else { return nil }
        let sorted = values.sorted()
        let mid = sorted.count / 2
        if sorted.count % 2 == 0 {
            return (sorted[mid - 1] + sorted[mid]) / 2
        }
        return sorted[mid]
    }

    /// Mean after trimming `trimFraction` of samples from each tail.
    static func trimmedMean(_ values: [Double], trimFraction: Double = 0.1) -> Double? {
        guard !values.isEmpty else { return nil }
        let sorted = values.sorted()
        let trimCount = Int(Double(sorted.count) * trimFraction)
        let kept = sorted.dropFirst(trimCount).dropLast(trimCount)
        guard !kept.isEmpty else { return median(values) }
        return kept.reduce(0, +) / Double(kept.count)
    }

    /// Population standard deviation, or nil for fewer than 2 values.
    static func standardDeviation(_ values: [Double]) -> Double? {
        guard values.count >= 2 else { return nil }
        let mean = values.reduce(0, +) / Double(values.count)
        let variance = values.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(values.count)
        return variance.squareRoot()
    }
}
