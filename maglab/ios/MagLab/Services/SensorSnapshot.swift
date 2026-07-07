import Foundation

/// The latest fused reading from every active sensor, captured at one
/// instant by the recording loop. Nil fields mean "sensor unavailable or
/// no reading yet" — never zero-filled.
struct SensorSnapshot {
    var timestamp: Date = Date()

    // Location
    var latitude: Double?
    var longitude: Double?
    var horizontalAccuracyM: Double?
    var altitudeM: Double?
    var verticalAccuracyM: Double?
    var speedMps: Double?
    var courseDeg: Double?
    /// Timestamp of the GPS fix itself, for staleness detection.
    var locationFixTimestamp: Date?

    // Magnetometer (µT)
    var magX_uT: Double?
    var magY_uT: Double?
    var magZ_uT: Double?

    // Motion
    var userAccelX: Double?
    var userAccelY: Double?
    var userAccelZ: Double?
    var gyroX: Double?
    var gyroY: Double?
    var gyroZ: Double?
    var pitch: Double?
    var roll: Double?
    var yaw: Double?

    // Barometer
    var pressureHpa: Double?
    var relativeAltitudeM: Double?

    // Availability / permissions
    var magnetometerAvailable: Bool = false
    var barometerAvailable: Bool = false
    var motionAvailable: Bool = false
    var locationAuthorized: Bool = false
    var isMockData: Bool = false

    var userAccelMagnitude: Double? {
        guard let x = userAccelX, let y = userAccelY, let z = userAccelZ else { return nil }
        return (x * x + y * y + z * z).squareRoot()
    }

    var rotationRateMagnitude: Double? {
        guard let x = gyroX, let y = gyroY, let z = gyroZ else { return nil }
        return (x * x + y * y + z * z).squareRoot()
    }

    func gpsFixAgeSeconds(asOf now: Date = Date()) -> Double? {
        guard let fix = locationFixTimestamp else { return nil }
        return now.timeIntervalSince(fix)
    }
}

/// Common interface for the real hardware manager and the mock generator,
/// so the recording engine and UI never care which one is running.
protocol SensorProviding: AnyObject {
    var isMock: Bool { get }
    /// Ask for location + motion permissions. Safe to call repeatedly.
    func requestPermissions()
    func start()
    func stop()
    /// Latest fused reading. Called from the main-actor sampling loop.
    func latestSnapshot() -> SensorSnapshot
}
