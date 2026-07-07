import SwiftUI
import SwiftData

@main
struct MagLabApp: App {

    /// Shared container so the recording engine can create its own
    /// ModelContext without threading contexts through view initialisers.
    static let sharedModelContainer: ModelContainer = {
        let schema = Schema([
            Survey.self,
            SurveyRun.self,
            SensorSample.self,
            SurveyMarker.self,
            AnomalyEvent.self,
        ])
        let configuration = ModelConfiguration(schema: schema)
        do {
            return try ModelContainer(for: schema, configurations: [configuration])
        } catch {
            fatalError("MagLab could not create its local store: \(error)")
        }
    }()

    var body: some Scene {
        WindowGroup {
            HomeView()
        }
        .modelContainer(Self.sharedModelContainer)
    }
}
