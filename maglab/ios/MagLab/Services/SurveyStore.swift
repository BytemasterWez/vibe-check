import Foundation
import SwiftData

/// Query helpers over the SwiftData store. Models reference each other by
/// UUID (to stay export/sync-stable), so cascade behaviour lives here.
enum SurveyStore {

    static func runs(for survey: Survey, in context: ModelContext) -> [SurveyRun] {
        let surveyId = survey.id
        let descriptor = FetchDescriptor<SurveyRun>(
            predicate: #Predicate { $0.surveyId == surveyId },
            sortBy: [SortDescriptor(\.startedAt)]
        )
        return (try? context.fetch(descriptor)) ?? []
    }

    static func samples(for survey: Survey, in context: ModelContext) -> [SensorSample] {
        let surveyId = survey.id
        let descriptor = FetchDescriptor<SensorSample>(
            predicate: #Predicate { $0.surveyId == surveyId },
            sortBy: [SortDescriptor(\.timestampUtc)]
        )
        return (try? context.fetch(descriptor)) ?? []
    }

    static func sampleCount(for survey: Survey, in context: ModelContext) -> Int {
        let surveyId = survey.id
        let descriptor = FetchDescriptor<SensorSample>(
            predicate: #Predicate { $0.surveyId == surveyId }
        )
        return (try? context.fetchCount(descriptor)) ?? 0
    }

    static func markers(for survey: Survey, in context: ModelContext) -> [SurveyMarker] {
        let surveyId = survey.id
        let descriptor = FetchDescriptor<SurveyMarker>(
            predicate: #Predicate { $0.surveyId == surveyId },
            sortBy: [SortDescriptor(\.timestampUtc)]
        )
        return (try? context.fetch(descriptor)) ?? []
    }

    static func anomalyEvents(for survey: Survey, in context: ModelContext) -> [AnomalyEvent] {
        let surveyId = survey.id
        let descriptor = FetchDescriptor<AnomalyEvent>(
            predicate: #Predicate { $0.surveyId == surveyId },
            sortBy: [SortDescriptor(\.startTime)]
        )
        return (try? context.fetch(descriptor)) ?? []
    }

    /// Delete a survey and everything recorded under it.
    static func delete(_ survey: Survey, in context: ModelContext) {
        for run in runs(for: survey, in: context) { context.delete(run) }
        for sample in samples(for: survey, in: context) { context.delete(sample) }
        for marker in markers(for: survey, in: context) { context.delete(marker) }
        for event in anomalyEvents(for: survey, in: context) { context.delete(event) }
        context.delete(survey)
        try? context.save()
    }

    /// Copy a survey's setup (not its data) into a fresh survey.
    static func duplicateSetup(of survey: Survey, in context: ModelContext) -> Survey {
        let copy = Survey(
            name: survey.name + " (repeat)",
            targetType: survey.targetType,
            mountPosition: survey.mountPosition,
            surveyPattern: survey.surveyPattern,
            signalModule: survey.signalModule,
            operatorNotes: survey.operatorNotes,
            weatherNotes: survey.weatherNotes,
            contaminationNotes: survey.contaminationNotes,
            shareSetting: survey.shareSetting,
            localOnly: survey.localOnly
        )
        context.insert(copy)
        try? context.save()
        return copy
    }
}
