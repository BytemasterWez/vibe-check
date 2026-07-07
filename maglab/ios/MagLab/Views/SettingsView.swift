import SwiftUI

/// Settings. v1 covers development options; the contributor/sync section
/// (backend URL, API token, upload + precision modes) is built in Phase 8
/// and stays visibly disabled until then so the consent flow is explicit.
struct SettingsView: View {
    @AppStorage(SensorFactory.mockModeDefaultsKey) private var mockSensorsEnabled = false

    var body: some View {
        Form {
            Section {
                Toggle("Mock sensor mode", isOn: $mockSensorsEnabled)
            } header: {
                Text("Development")
            } footer: {
                Text("Generates a simulated walk with planted anomalies. Always on in the simulator (it has no magnetometer). Mock samples are flagged mock_sensor_data and must never enter real datasets.")
            }

            Section {
                LabeledContent("Backend sync", value: "Phase 7")
                LabeledContent("Contributor mode", value: "Phase 8")
            } header: {
                Text("Contributor / sync")
            } footer: {
                Text("Upload is off until backend sync ships, and will stay off by default. Data sharing will always require explicit consent, an explicit upload mode, and an explicit GPS precision choice.")
            }
        }
        .navigationTitle("Settings")
    }
}

#Preview {
    NavigationStack { SettingsView() }
}
