import Foundation
import SwiftData

/// A manual field annotation dropped by the operator during a run
/// (known target, fence, suspected anomaly, contamination note, ...).
@Model
final class SurveyMarker {
    @Attribute(.unique) var id: UUID
    var surveyId: UUID
    var runId: UUID
    var timestampUtc: Date
    var latitude: Double?
    var longitude: Double?
    var markerType: String
    var note: String
    var confidence: Double?
    var externalPhotoReference: String?

    init(
        id: UUID = UUID(),
        surveyId: UUID,
        runId: UUID,
        timestampUtc: Date = Date(),
        latitude: Double? = nil,
        longitude: Double? = nil,
        markerType: String = MarkerType.other.rawValue,
        note: String = "",
        confidence: Double? = nil,
        externalPhotoReference: String? = nil
    ) {
        self.id = id
        self.surveyId = surveyId
        self.runId = runId
        self.timestampUtc = timestampUtc
        self.latitude = latitude
        self.longitude = longitude
        self.markerType = markerType
        self.note = note
        self.confidence = confidence
        self.externalPhotoReference = externalPhotoReference
    }
}
