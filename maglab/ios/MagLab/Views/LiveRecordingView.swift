import SwiftUI
import SwiftData

/// Live Recording screen: live metric cards, warnings, and the recording
/// controls. The map toggle lands in Phase 4.
@MainActor
struct LiveRecordingView: View {
    @Environment(\.dismiss) private var dismiss

    let survey: Survey
    @StateObject private var engine: RecordingEngine

    @State private var showingMarkerSheet = false
    @State private var markerType: MarkerType = .suspectedAnomaly
    @State private var markerNote = ""

    init(survey: Survey) {
        self.survey = survey
        _engine = StateObject(wrappedValue: RecordingEngine(
            container: MagLabApp.sharedModelContainer,
            sensors: SensorFactory.make()
        ))
    }

    private var sample: SensorSample? { engine.latestSample }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if !engine.warnings.isEmpty {
                    warningsCard
                }

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())],
                          spacing: 10) {
                    metric("Duration", Format.duration(engine.elapsedSeconds))
                    metric("Samples", "\(engine.sampleCount)")
                    metric("GPS accuracy", Format.meters(sample?.horizontalAccuracyM))
                    metric("Speed", Format.speed(sample?.speedMps))
                    metric("Latitude", Format.coordinate(sample?.latitude))
                    metric("Longitude", Format.coordinate(sample?.longitude))
                    metric("Mag total", Format.microtesla(sample?.magTotal_uT))
                    metric("Baseline", Format.microtesla(sample?.localBaseline_uT))
                    metric("Residual", Format.microtesla(sample?.localResidual_uT),
                           highlight: abs(sample?.localResidual_uT ?? 0) >= 5)
                    metric("Anomaly score", Format.score(sample?.anomalyScore),
                           highlight: (sample?.anomalyScore ?? 0) >= 60)
                    metric("Confidence", Format.confidence(sample?.modelConfidence))
                    metric("Likely class", likelyClassText)
                    metric("Pressure", Format.pressure(sample?.pressureHpa))
                    metric("Rel. altitude", Format.meters(sample?.relativeAltitudeM))
                    metric("GPS quality", Format.quality(sample?.gpsQualityScore))
                    metric("Motion quality", Format.quality(sample?.motionQualityScore))
                }

                controls
            }
            .padding()
        }
        .navigationTitle(survey.name)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(engine.state == .recording || engine.state == .paused)
        .onAppear {
            if engine.state == .idle {
                engine.start(survey: survey)
            }
        }
        .onDisappear {
            if engine.state == .recording || engine.state == .paused {
                engine.stopAndSave()
            }
            engine.discardIfEmpty()
        }
        .sheet(isPresented: $showingMarkerSheet) {
            markerSheet
        }
    }

    private var likelyClassText: String {
        guard let raw = sample?.likelyClass,
              let likelyClass = LikelyClass(rawValue: raw) else { return "—" }
        return likelyClass.displayName
    }

    private var warningsCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(engine.warnings, id: \.self) { warning in
                Label(warning, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.yellow.opacity(0.15), in: RoundedRectangle(cornerRadius: 10))
    }

    private func metric(_ label: String, _ value: String, highlight: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(value)
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(highlight ? .orange : .primary)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
    }

    private var controls: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                if engine.state == .recording {
                    Button("Pause") { engine.pause() }
                        .buttonStyle(.bordered)
                        .frame(maxWidth: .infinity)
                } else if engine.state == .paused {
                    Button("Resume") { engine.resume() }
                        .buttonStyle(.borderedProminent)
                        .frame(maxWidth: .infinity)
                }
                Button("Add Marker") {
                    markerType = .suspectedAnomaly
                    markerNote = ""
                    showingMarkerSheet = true
                }
                .buttonStyle(.bordered)
                .frame(maxWidth: .infinity)
                .disabled(engine.state != .recording && engine.state != .paused)
            }
            Button("Stop and Save") {
                engine.stopAndSave()
                dismiss()
            }
            .buttonStyle(.borderedProminent)
            .tint(.red)
            .frame(maxWidth: .infinity)
            .disabled(engine.state != .recording && engine.state != .paused)

            Label("Live map arrives in Phase 4", systemImage: "map")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var markerSheet: some View {
        NavigationStack {
            Form {
                Picker("Marker type", selection: $markerType) {
                    ForEach(MarkerType.allCases) { Text($0.displayName).tag($0) }
                }
                TextField("Note", text: $markerNote, axis: .vertical)
            }
            .navigationTitle("Add Marker")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showingMarkerSheet = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        engine.addMarker(type: markerType, note: markerNote)
                        showingMarkerSheet = false
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
