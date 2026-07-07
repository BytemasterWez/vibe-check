import SwiftUI
import SwiftData

/// New Survey setup form. Sharing defaults to private local-only; nothing
/// is ever uploaded without an explicit user choice.
struct NewSurveyView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var targetType: TargetType = .unknownAnomalyHunt
    @State private var mountPosition: MountPosition = .hand
    @State private var surveyPattern: SurveyPattern = .freeWalk
    @State private var signalModule: SignalModuleOption = .fullSensorPack
    @State private var operatorNotes = ""
    @State private var weatherNotes = ""
    @State private var contaminationNotes = ""
    @State private var shareSetting: ShareSetting = .privateLocalOnly

    var body: some View {
        NavigationStack {
            Form {
                Section("Survey") {
                    TextField("Survey name", text: $name)
                    Picker("Target type", selection: $targetType) {
                        ForEach(TargetType.allCases) { Text($0.displayName).tag($0) }
                    }
                    Picker("Mount position", selection: $mountPosition) {
                        ForEach(MountPosition.allCases) { Text($0.displayName).tag($0) }
                    }
                    Picker("Survey pattern", selection: $surveyPattern) {
                        ForEach(SurveyPattern.allCases) { Text($0.displayName).tag($0) }
                    }
                    Picker("Signal module", selection: $signalModule) {
                        ForEach(SignalModuleOption.v1Selectable) { Text($0.displayName).tag($0) }
                    }
                }

                Section("Notes") {
                    TextField("Operator notes", text: $operatorNotes, axis: .vertical)
                    TextField("Weather notes", text: $weatherNotes, axis: .vertical)
                    TextField("Visible contamination (keys, fences, vehicles…)",
                              text: $contaminationNotes, axis: .vertical)
                }

                Section {
                    Picker("Sharing", selection: $shareSetting) {
                        ForEach(ShareSetting.allCases) { Text($0.displayName).tag($0) }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } header: {
                    Text("Consent / sharing")
                } footer: {
                    Text("Default is private local-only. Data leaves this device only if you pick a sharing mode AND enable upload in Settings (Phase 7/8). Precise-GPS sharing is always an explicit choice.")
                }
            }
            .navigationTitle("New Survey")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { createSurvey() }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private func createSurvey() {
        let contamination = contaminationNotes
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }

        let survey = Survey(
            name: name.trimmingCharacters(in: .whitespaces),
            targetType: targetType.rawValue,
            mountPosition: mountPosition.rawValue,
            surveyPattern: surveyPattern.rawValue,
            signalModule: signalModule.rawValue,
            operatorNotes: operatorNotes,
            weatherNotes: weatherNotes,
            contaminationNotes: contamination,
            shareSetting: shareSetting.rawValue,
            localOnly: !shareSetting.allowsUpload,
            syncStatus: shareSetting.allowsUpload
                ? SyncStatus.notSynced.rawValue
                : SyncStatus.localOnly.rawValue
        )
        modelContext.insert(survey)
        try? modelContext.save()
        dismiss()
    }
}

#Preview {
    NewSurveyView()
        .modelContainer(for: [Survey.self], inMemory: true)
}
