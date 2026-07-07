import Foundation

/// GPS fix quality on a 0–1 scale.
enum GpsQuality {
    /// 1.0 at ≤5 m accuracy, tapering linearly to 0.1 at ≥30 m.
    /// Missing or invalid (negative) accuracy scores 0. A stale fix
    /// (older than `staleAfterSeconds`) is halved.
    static func score(
        horizontalAccuracyM: Double?,
        fixAgeSeconds: Double? = nil,
        staleAfterSeconds: Double = 5
    ) -> Double {
        guard let accuracy = horizontalAccuracyM, accuracy >= 0 else { return 0 }
        var score: Double
        if accuracy <= 5 {
            score = 1
        } else if accuracy >= 30 {
            score = 0.1
        } else {
            score = 1 - (accuracy - 5) / 25 * 0.9
        }
        if let age = fixAgeSeconds, age > staleAfterSeconds {
            score *= 0.5
        }
        return score
    }
}

/// Device motion stability on a 0–1 scale. High user-acceleration variance
/// (shaking, jogging) and fast rotation both distort magnetometer readings.
enum MotionQuality {
    /// - accelStdDev: standard deviation of user-acceleration magnitude (g)
    ///   over the recent window.
    /// - rotationRateMagnitude: |gyro| in rad/s for the current sample.
    static func score(accelStdDev: Double, rotationRateMagnitude: Double) -> Double {
        let accelPenalty = min(accelStdDev / 0.8, 1.0) * 0.6
        let rotationPenalty = min(rotationRateMagnitude / 3.0, 1.0) * 0.4
        return max(0, 1 - accelPenalty - rotationPenalty)
    }
}
