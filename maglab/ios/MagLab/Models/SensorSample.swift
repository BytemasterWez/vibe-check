import Foundation
import SwiftData

/// One timestamp-aligned fused sensor reading. Sensor fields are optional
/// because hardware availability varies (no barometer on some devices, no
/// magnetometer in the simulator); derived/scoring fields are always set.
@Model
final class SensorSample {
    @Attribute(.unique) var id: UUID
    var surveyId: UUID
    var runId: UUID
    var timestampUtc: Date

    // GPS
    var latitude: Double?
    var longitude: Double?
    var horizontalAccuracyM: Double?
    var altitudeM: Double?
    var verticalAccuracyM: Double?
    var speedMps: Double?
    var courseDeg: Double?

    // Magnetometer (microtesla)
    var magX_uT: Double?
    var magY_uT: Double?
    var magZ_uT: Double?
    var magTotal_uT: Double?

    // Motion
    var accelX: Double?
    var accelY: Double?
    var accelZ: Double?
    var gyroX: Double?
    var gyroY: Double?
    var gyroZ: Double?
    var pitch: Double?
    var roll: Double?
    var yaw: Double?

    // Barometer
    var pressureHpa: Double?
    var relativeAltitudeM: Double?

    // Derived / scoring
    var localBaseline_uT: Double?
    var localResidual_uT: Double?
    var gpsQualityScore: Double
    var motionQualityScore: Double
    var anomalyScore: Double
    var modelConfidence: Double
    var likelyClass: String
    var qualityFlags: [String]

    init(
        id: UUID = UUID(),
        surveyId: UUID,
        runId: UUID,
        timestampUtc: Date = Date(),
        latitude: Double? = nil,
        longitude: Double? = nil,
        horizontalAccuracyM: Double? = nil,
        altitudeM: Double? = nil,
        verticalAccuracyM: Double? = nil,
        speedMps: Double? = nil,
        courseDeg: Double? = nil,
        magX_uT: Double? = nil,
        magY_uT: Double? = nil,
        magZ_uT: Double? = nil,
        magTotal_uT: Double? = nil,
        accelX: Double? = nil,
        accelY: Double? = nil,
        accelZ: Double? = nil,
        gyroX: Double? = nil,
        gyroY: Double? = nil,
        gyroZ: Double? = nil,
        pitch: Double? = nil,
        roll: Double? = nil,
        yaw: Double? = nil,
        pressureHpa: Double? = nil,
        relativeAltitudeM: Double? = nil,
        localBaseline_uT: Double? = nil,
        localResidual_uT: Double? = nil,
        gpsQualityScore: Double = 0,
        motionQualityScore: Double = 0,
        anomalyScore: Double = 0,
        modelConfidence: Double = 0,
        likelyClass: String = LikelyClass.insufficientData.rawValue,
        qualityFlags: [String] = []
    ) {
        self.id = id
        self.surveyId = surveyId
        self.runId = runId
        self.timestampUtc = timestampUtc
        self.latitude = latitude
        self.longitude = longitude
        self.horizontalAccuracyM = horizontalAccuracyM
        self.altitudeM = altitudeM
        self.verticalAccuracyM = verticalAccuracyM
        self.speedMps = speedMps
        self.courseDeg = courseDeg
        self.magX_uT = magX_uT
        self.magY_uT = magY_uT
        self.magZ_uT = magZ_uT
        self.magTotal_uT = magTotal_uT
        self.accelX = accelX
        self.accelY = accelY
        self.accelZ = accelZ
        self.gyroX = gyroX
        self.gyroY = gyroY
        self.gyroZ = gyroZ
        self.pitch = pitch
        self.roll = roll
        self.yaw = yaw
        self.pressureHpa = pressureHpa
        self.relativeAltitudeM = relativeAltitudeM
        self.localBaseline_uT = localBaseline_uT
        self.localResidual_uT = localResidual_uT
        self.gpsQualityScore = gpsQualityScore
        self.motionQualityScore = motionQualityScore
        self.anomalyScore = anomalyScore
        self.modelConfidence = modelConfidence
        self.likelyClass = likelyClass
        self.qualityFlags = qualityFlags
    }
}

extension SensorSample {
    /// Magnetic total intensity in µT: sqrt(x² + y² + z²).
    static func magneticTotal(x: Double, y: Double, z: Double) -> Double {
        (x * x + y * y + z * z).squareRoot()
    }
}
