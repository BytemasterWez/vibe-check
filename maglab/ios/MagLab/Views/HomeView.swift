import SwiftUI
import SwiftData

/// Home / Surveys screen: sync overview counters plus the saved survey list.
struct HomeView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Survey.createdAt, order: .reverse) private var surveys: [Survey]
    @Query private var runs: [SurveyRun]

    @State private var showingNewSurvey = false

    private var uploadedCount: Int {
        surveys.filter { $0.syncStatus == SyncStatus.synced.rawValue }.count
    }

    private var unsyncedCount: Int {
        surveys.filter {
            $0.syncStatus != SyncStatus.synced.rawValue && !$0.localOnly
        }.count
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        statCell("Local", value: surveys.count)
                        statCell("Uploaded", value: uploadedCount)
                        statCell("Unsynced", value: unsyncedCount)
                    }
                    .listRowBackground(Color.clear)
                } header: {
                    Text("Sync status")
                } footer: {
                    Text("Backend sync arrives in Phase 7. All surveys are private and local-only by default.")
                }

                Section("Saved surveys") {
                    if surveys.isEmpty {
                        ContentUnavailableView(
                            "No surveys yet",
                            systemImage: "sensor.tag.radiowaves.forward",
                            description: Text("Create a survey to start logging magnetic field data.")
                        )
                    }
                    ForEach(surveys) { survey in
                        NavigationLink(value: survey.id) {
                            SurveyCardView(survey: survey, runs: runs.filter { $0.surveyId == survey.id })
                        }
                    }
                    .onDelete(perform: deleteSurveys)
                }
            }
            .navigationTitle("MagLab")
            .navigationDestination(for: UUID.self) { surveyId in
                if let survey = surveys.first(where: { $0.id == surveyId }) {
                    SurveyDetailView(survey: survey)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink {
                        AboutSafetyView()
                    } label: {
                        Image(systemName: "info.circle")
                    }
                }
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink {
                        SettingsView()
                    } label: {
                        Image(systemName: "gearshape")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingNewSurvey = true
                    } label: {
                        Label("New Survey", systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingNewSurvey) {
                NewSurveyView()
            }
        }
    }

    private func statCell(_ label: String, value: Int) -> some View {
        VStack {
            Text("\(value)").font(.title2).bold()
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func deleteSurveys(at offsets: IndexSet) {
        for index in offsets {
            SurveyStore.delete(surveys[index], in: modelContext)
        }
    }
}

/// One survey row: name, setup summary, run/sample counts, sync state.
struct SurveyCardView: View {
    let survey: Survey
    let runs: [SurveyRun]

    private var totalSamples: Int { runs.reduce(0) { $0 + $1.sampleCount } }
    private var maxScore: Double { runs.compactMap(\.maxAnomalyScore).max() ?? 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(survey.name).font(.headline)
                Spacer()
                if survey.localOnly {
                    Label("Local", systemImage: "iphone")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .labelStyle(.titleAndIcon)
                }
            }
            Text(TargetType(rawValue: survey.targetType)?.displayName ?? survey.targetType)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            HStack(spacing: 12) {
                Label(survey.createdAt.formatted(date: .abbreviated, time: .shortened),
                      systemImage: "calendar")
                Label("\(runs.count) runs", systemImage: "repeat")
                Label("\(totalSamples) samples", systemImage: "waveform")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            if maxScore > 0 {
                Text("Max anomaly score \(Format.score(maxScore))")
                    .font(.caption)
                    .foregroundStyle(maxScore >= 60 ? .orange : .secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

#Preview {
    HomeView()
        .modelContainer(for: [Survey.self, SurveyRun.self, SensorSample.self,
                              SurveyMarker.self, AnomalyEvent.self],
                        inMemory: true)
}
