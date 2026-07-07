import Foundation

/// Extension point for signal sources. v1 ships magnetometer, motion,
/// location and barometer. Future modules (road vibration, AM/SDR
/// conductivity, external ESP32, camera context) plug in here without
/// touching the recording pipeline.
///
/// Privacy boundary (non-negotiable): no covert tracking modules. Wi-Fi
/// probe-request logging is not possible on iOS and any future external
/// footfall sensor must be consent-only, site-authorised, anonymised and
/// legally reviewed before it is even prototyped. Smart-speaker acoustic
/// echo analysis is out of scope entirely.
protocol SignalModule {
    var id: String { get }
    var name: String { get }
    func start()
    func stop()
}

/// Identifiers for the built-in v1 modules.
enum BuiltInSignalModuleID {
    static let magnetometer = "magnetometer"
    static let motion = "motion"
    static let location = "location"
    static let barometer = "barometer"
}
