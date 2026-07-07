import Foundation
import SwiftData

/// An anomaly is never a single spike — it is a cluster of consecutive
/// samples whose anomaly score stays above threshold. Clustering is built
/// in Phase 6; the model exists now so persistence, export and sync schemas
/// stay stable.
@Model
final class AnomalyEvent {
    @Attribute(.unique) var id: UUID
    var surveyId: UUID
    var runId: UUID
    var startTime: Date
    var endTime: Date
    var centreLat: Double?
    var centreLon: Double?
    var sampleCount: Int
    var maxScore: Double
    var meanScore: Double
    var maxResidual_uT: Double
    var confidence: Double
    var likelyClass: String
    var qualityFlags: [String]

    init(
        id: UUID = UUID(),
        surveyId: UUID,
        runId: UUID,
        startTime: Date,
        endTime: Date,
        centreLat: Double? = nil,
        centreLon: Double? = nil,
        sampleCount: Int = 0,
        maxScore: Double = 0,
        meanScore: Double = 0,
        maxResidual_uT: Double = 0,
        confidence: Double = 0,
        likelyClass: String = LikelyClass.insufficientData.rawValue,
        qualityFlags: [String] = []
    ) {
        self.id = id
        self.surveyId = surveyId
        self.runId = runId
        self.startTime = startTime
        self.endTime = endTime
        self.centreLat = centreLat
        self.centreLon = centreLon
        self.sampleCount = sampleCount
        self.maxScore = maxScore
        self.meanScore = meanScore
        self.maxResidual_uT = maxResidual_uT
        self.confidence = confidence
        self.likelyClass = likelyClass
        self.qualityFlags = qualityFlags
    }
}
