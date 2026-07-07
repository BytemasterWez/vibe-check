import Foundation

/// Deterministic simulated sensors so every screen and the full scoring
/// pipeline work in the simulator (mock mode is mandatory — development
/// must never require a physical walk).
///
/// Simulates an operator walking east at ~1.4 m/s through a ~50 µT
/// background field, passing a buried ferrous target every `anomalySpacingM`
/// metres. Noise is generated from fixed sinusoids rather than a RNG so
/// repeated mock runs produce near-identical tracks — which is exactly what
/// the Phase 6 repeatability engine needs for its "matching runs score
/// high" acceptance test.
final class MockSensorManager: SensorProviding {

    let isMock = true

    // Walk parameters
    private let originLatitude = 51.50072
    private let originLongitude = -0.12462
    private let walkSpeedMps = 1.4
    private let anomalySpacingM = 40.0
    private let anomalyPeak_uT = 12.0
    private let anomalyWidthM = 5.0
    private let backgroundField_uT = 49.0

    private var startedAt: Date?

    func requestPermissions() {}

    func start() {
        if startedAt == nil { startedAt = Date() }
    }

    func stop() {
        startedAt = nil
    }

    func latestSnapshot() -> SensorSnapshot {
        let now = Date()
        let t = startedAt.map { now.timeIntervalSince($0) } ?? 0
        let distanceM = t * walkSpeedMps

        var snapshot = SensorSnapshot()
        snapshot.timestamp = now
        snapshot.isMockData = true
        snapshot.magnetometerAvailable = true
        snapshot.motionAvailable = true
        snapshot.barometerAvailable = true
        snapshot.locationAuthorized = true

        // Walk due east. 1 degree of longitude ≈ 111,320 m × cos(latitude).
        let metersPerDegreeLon = 111_320.0 * cos(originLatitude * .pi / 180)
        snapshot.latitude = originLatitude + sin(t / 9) * 0.000002
        snapshot.longitude = originLongitude + distanceM / metersPerDegreeLon
        snapshot.horizontalAccuracyM = 5.0 + sin(t / 7) * 1.5
        snapshot.altitudeM = 32.0 + sin(t / 30) * 0.5
        snapshot.verticalAccuracyM = 8.0
        snapshot.speedMps = walkSpeedMps + sin(t / 3) * 0.15
        snapshot.courseDeg = 90.0
        snapshot.locationFixTimestamp = now

        // Magnetic field: background + Gaussian bump around each buried
        // target + small deterministic pseudo-noise.
        let nearestTargetM = (distanceM / anomalySpacingM).rounded() * anomalySpacingM
        let offsetM = distanceM - nearestTargetM
        let bump = anomalyPeak_uT * exp(-(offsetM * offsetM) / (2 * anomalyWidthM * anomalyWidthM))
        let noise = sin(t * 7.3) * 0.35 + sin(t * 13.7) * 0.15
        let total = backgroundField_uT + bump + noise

        // Split the total across axes with a slowly varying orientation.
        let heading = 0.3 + sin(t / 20) * 0.1
        snapshot.magX_uT = total * cos(heading) * 0.55
        snapshot.magY_uT = total * sin(heading) * 0.55
        snapshot.magZ_uT = -(total * total
            - pow(total * cos(heading) * 0.55, 2)
            - pow(total * sin(heading) * 0.55, 2)).squareRoot()

        // Gentle walking motion.
        snapshot.userAccelX = sin(t * 5.5) * 0.05
        snapshot.userAccelY = cos(t * 5.5) * 0.05
        snapshot.userAccelZ = sin(t * 11) * 0.08
        snapshot.gyroX = sin(t * 4) * 0.1
        snapshot.gyroY = cos(t * 4) * 0.1
        snapshot.gyroZ = sin(t * 2) * 0.05
        snapshot.pitch = 0.5 + sin(t * 5.5) * 0.03
        snapshot.roll = sin(t * 5.5) * 0.03
        snapshot.yaw = heading

        // Barometer with a slow pressure drift and mild route relief.
        snapshot.pressureHpa = 1012.0 - t * 0.0005 + sin(distanceM / 80) * 0.06
        snapshot.relativeAltitudeM = sin(distanceM / 80) * 0.5

        return snapshot
    }
}
