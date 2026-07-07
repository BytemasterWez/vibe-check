import Foundation

/// Chooses the sensor source for a recording session. The simulator always
/// gets mock sensors (it has no magnetometer); on device the user can force
/// mock mode from Settings for indoor development and demos.
enum SensorFactory {
    static let mockModeDefaultsKey = "mockSensorsEnabled"

    static func make() -> SensorProviding {
        #if targetEnvironment(simulator)
        return MockSensorManager()
        #else
        if UserDefaults.standard.bool(forKey: mockModeDefaultsKey) {
            return MockSensorManager()
        }
        return SensorManager()
        #endif
    }
}
