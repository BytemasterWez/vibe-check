import Foundation
import SwiftData

/// A field survey: one named session setup that can contain one or more
/// recording runs. Relationships are by UUID foreign key (not SwiftData
/// relationships) so the same identifiers survive export and backend sync.
@Model
final class Survey {
    @Attribute(.unique) var id: UUID
    var ownerContributorId: UUID?
    var name: String
    var createdAt: Date
    var targetType: String
    var mountPosition: String
    var surveyPattern: String
    var signalModule: String
    var operatorNotes: String
    var weatherNotes: String
    var contaminationNotes: [String]
    var shareSetting: String
    var localOnly: Bool
    var syncedAt: Date?
    var syncStatus: String

    init(
        id: UUID = UUID(),
        ownerContributorId: UUID? = nil,
        name: String,
        createdAt: Date = Date(),
        targetType: String = TargetType.unknownAnomalyHunt.rawValue,
        mountPosition: String = MountPosition.hand.rawValue,
        surveyPattern: String = SurveyPattern.freeWalk.rawValue,
        signalModule: String = SignalModuleOption.fullSensorPack.rawValue,
        operatorNotes: String = "",
        weatherNotes: String = "",
        contaminationNotes: [String] = [],
        shareSetting: String = ShareSetting.privateLocalOnly.rawValue,
        localOnly: Bool = true,
        syncedAt: Date? = nil,
        syncStatus: String = SyncStatus.localOnly.rawValue
    ) {
        self.id = id
        self.ownerContributorId = ownerContributorId
        self.name = name
        self.createdAt = createdAt
        self.targetType = targetType
        self.mountPosition = mountPosition
        self.surveyPattern = surveyPattern
        self.signalModule = signalModule
        self.operatorNotes = operatorNotes
        self.weatherNotes = weatherNotes
        self.contaminationNotes = contaminationNotes
        self.shareSetting = shareSetting
        self.localOnly = localOnly
        self.syncedAt = syncedAt
        self.syncStatus = syncStatus
    }
}
