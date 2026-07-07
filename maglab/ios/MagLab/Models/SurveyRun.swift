import Foundation
import SwiftData

/// One continuous recording within a survey. Repeating the same line three
/// times produces three runs under the same survey, which is what the
/// repeatability engine (Phase 6) compares.
@Model
final class SurveyRun {
    @Attribute(.unique) var id: UUID
    var surveyId: UUID
    var startedAt: Date
    var endedAt: Date?
    var isComplete: Bool
    var sampleCount: Int
    var medianGpsAccuracyM: Double?
    var maxAnomalyScore: Double?
    var highConfidenceAnomalyCount: Int
    var repeatabilityGroupId: UUID?
    var syncedAt: Date?
    var syncStatus: String

    init(
        id: UUID = UUID(),
        surveyId: UUID,
        startedAt: Date = Date(),
        endedAt: Date? = nil,
        isComplete: Bool = false,
        sampleCount: Int = 0,
        medianGpsAccuracyM: Double? = nil,
        maxAnomalyScore: Double? = nil,
        highConfidenceAnomalyCount: Int = 0,
        repeatabilityGroupId: UUID? = nil,
        syncedAt: Date? = nil,
        syncStatus: String = SyncStatus.localOnly.rawValue
    ) {
        self.id = id
        self.surveyId = surveyId
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.isComplete = isComplete
        self.sampleCount = sampleCount
        self.medianGpsAccuracyM = medianGpsAccuracyM
        self.maxAnomalyScore = maxAnomalyScore
        self.highConfidenceAnomalyCount = highConfidenceAnomalyCount
        self.repeatabilityGroupId = repeatabilityGroupId
        self.syncedAt = syncedAt
        self.syncStatus = syncStatus
    }
}
