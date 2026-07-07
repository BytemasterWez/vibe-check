import Foundation
import CoreLocation
import CoreMotion

/// Real-hardware sensor manager. Owns Core Location, Core Motion and the
/// barometer, keeps the latest reading from each, and fuses them into
/// SensorSnapshot values on demand.
///
/// Defensive by design: never assumes a magnetometer or barometer exists,
/// never crashes in the simulator (it simply reports sensors unavailable —
/// use MockSensorManager there instead).
final class SensorManager: NSObject, SensorProviding, CLLocationManagerDelegate {

    let isMock = false

    private let locationManager = CLLocationManager()
    private let motionManager = CMMotionManager()
    private let altimeter = CMAltimeter()
    private let motionQueue = OperationQueue()

    // Latest readings, guarded by `lock` because Core Motion callbacks
    // arrive on the motion queue while snapshots are read on the main actor.
    private let lock = NSLock()
    private var latestLocation: CLLocation?
    private var latestMagneticField: CMMagneticField?
    private var latestDeviceMotion: CMDeviceMotion?
    private var latestPressureHpa: Double?
    private var latestRelativeAltitudeM: Double?
    private var authorizationStatus: CLAuthorizationStatus = .notDetermined

    override init() {
        super.init()
        motionQueue.name = "com.maglab.sensor-updates"
        motionQueue.maxConcurrentOperationCount = 1
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = kCLDistanceFilterNone
        locationManager.activityType = .fitness
    }

    // MARK: - SensorProviding

    func requestPermissions() {
        if locationManager.authorizationStatus == .notDetermined {
            locationManager.requestWhenInUseAuthorization()
        }
    }

    func start() {
        requestPermissions()
        locationManager.startUpdatingLocation()

        // Raw magnetometer at the capture rate; total-field work only needs
        // magnitude so raw (uncalibrated) values are acceptable for v1.
        if motionManager.isMagnetometerAvailable {
            motionManager.magnetometerUpdateInterval = 1.0 / 20.0
            motionManager.startMagnetometerUpdates(to: motionQueue) { [weak self] data, _ in
                guard let self, let data else { return }
                self.lock.lock()
                self.latestMagneticField = data.magneticField
                self.lock.unlock()
            }
        }

        // Device motion for attitude, user acceleration and rotation rate.
        if motionManager.isDeviceMotionAvailable {
            motionManager.deviceMotionUpdateInterval = 1.0 / 20.0
            motionManager.startDeviceMotionUpdates(to: motionQueue) { [weak self] motion, _ in
                guard let self, let motion else { return }
                self.lock.lock()
                self.latestDeviceMotion = motion
                self.lock.unlock()
            }
        }

        if CMAltimeter.isRelativeAltitudeAvailable() {
            altimeter.startRelativeAltitudeUpdates(to: motionQueue) { [weak self] data, _ in
                guard let self, let data else { return }
                self.lock.lock()
                // CMAltitudeData pressure is in kPa; convert to hPa.
                self.latestPressureHpa = data.pressure.doubleValue * 10.0
                self.latestRelativeAltitudeM = data.relativeAltitude.doubleValue
                self.lock.unlock()
            }
        }
    }

    func stop() {
        locationManager.stopUpdatingLocation()
        if motionManager.isMagnetometerActive { motionManager.stopMagnetometerUpdates() }
        if motionManager.isDeviceMotionActive { motionManager.stopDeviceMotionUpdates() }
        altimeter.stopRelativeAltitudeUpdates()
    }

    func latestSnapshot() -> SensorSnapshot {
        lock.lock()
        let location = latestLocation
        let field = latestMagneticField
        let motion = latestDeviceMotion
        let pressure = latestPressureHpa
        let relativeAltitude = latestRelativeAltitudeM
        let status = authorizationStatus
        lock.unlock()

        var snapshot = SensorSnapshot()
        snapshot.timestamp = Date()
        snapshot.magnetometerAvailable = motionManager.isMagnetometerAvailable
        snapshot.motionAvailable = motionManager.isDeviceMotionAvailable
        snapshot.barometerAvailable = CMAltimeter.isRelativeAltitudeAvailable()
        snapshot.locationAuthorized =
            status == .authorizedWhenInUse || status == .authorizedAlways

        if let location, location.horizontalAccuracy >= 0 {
            snapshot.latitude = location.coordinate.latitude
            snapshot.longitude = location.coordinate.longitude
            snapshot.horizontalAccuracyM = location.horizontalAccuracy
            snapshot.altitudeM = location.altitude
            snapshot.verticalAccuracyM = location.verticalAccuracy >= 0 ? location.verticalAccuracy : nil
            snapshot.speedMps = location.speed >= 0 ? location.speed : nil
            snapshot.courseDeg = location.course >= 0 ? location.course : nil
            snapshot.locationFixTimestamp = location.timestamp
        }

        if let field {
            snapshot.magX_uT = field.x
            snapshot.magY_uT = field.y
            snapshot.magZ_uT = field.z
        }

        if let motion {
            snapshot.userAccelX = motion.userAcceleration.x
            snapshot.userAccelY = motion.userAcceleration.y
            snapshot.userAccelZ = motion.userAcceleration.z
            snapshot.gyroX = motion.rotationRate.x
            snapshot.gyroY = motion.rotationRate.y
            snapshot.gyroZ = motion.rotationRate.z
            snapshot.pitch = motion.attitude.pitch
            snapshot.roll = motion.attitude.roll
            snapshot.yaw = motion.attitude.yaw
        }

        snapshot.pressureHpa = pressure
        snapshot.relativeAltitudeM = relativeAltitude
        return snapshot
    }

    // MARK: - CLLocationManagerDelegate

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        lock.lock()
        latestLocation = location
        lock.unlock()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        lock.lock()
        authorizationStatus = manager.authorizationStatus
        lock.unlock()
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Keep the last good fix; staleness flagging handles degradation.
    }
}
