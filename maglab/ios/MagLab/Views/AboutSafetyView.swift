import SwiftUI

/// About / Safety screen. This wording is a product requirement, not
/// boilerplate: MagLab must never present itself as a professional
/// geophysical instrument. Keep claims to "repeatable local magnetic
/// anomaly detected with confidence X" — nothing stronger.
struct AboutSafetyView: View {
    var body: some View {
        List {
            Section("What MagLab is") {
                Text("""
                MagLab logs and maps local magnetic anomalies using iPhone sensors. \
                It is an experimental citizen-science and field-logging tool. \
                Results are not professional geophysical surveys and must not be \
                used for excavation, safety decisions, utility detection, \
                navigation or mineral claims.
                """)
            }

            Section("Reading the data honestly") {
                Text("""
                Magnetic readings can be distorted by keys, phones, watches, \
                vehicles, fences, power lines, bridges, reinforced concrete, \
                buried metal, railways and other infrastructure.
                """)
                Label("A single spike is not proof.", systemImage: "exclamationmark.triangle")
                Label("Repeatability matters.", systemImage: "repeat")
                Label("Test known controls first.", systemImage: "checkmark.seal")
            }

            Section("What MagLab never claims") {
                Text("""
                MagLab will never report "ore found", "pipe confirmed", "safe to \
                dig", "utility detected", "mineral deposit identified" or \
                "bedrock confirmed". The strongest claim it makes is: \
                "Repeatable local magnetic anomaly detected with confidence X."
                """)
            }

            Section("Privacy") {
                Text("""
                Surveys are private and stored only on this device by default. \
                Nothing is uploaded without your explicit consent and an explicit \
                sharing choice. Precise-GPS sharing is always opt-in. See \
                PRIVACY_AND_CONSENT in the project documentation for full details.
                """)
            }
        }
        .navigationTitle("About & Safety")
    }
}

#Preview {
    NavigationStack { AboutSafetyView() }
}
