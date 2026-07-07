import Foundation

// MARK: - Survey setup vocabularies
//
// All enums use stable snake_case raw values. Raw values are what gets
// persisted and exported — display names are UI-only and may change.

enum TargetType: String, CaseIterable, Identifiable {
    case knownMetalControl = "known_metal_control"
    case openGrassControl = "open_grass_control"
    case parkGridSurvey = "park_grid_survey"
    case roadFootpathSurvey = "road_footpath_survey"
    case oldIndustrialSite = "old_industrial_site"
    case geologyBoundaryTest = "geology_boundary_test"
    case manholeFenceControlObject = "manhole_fence_control_object"
    case unknownAnomalyHunt = "unknown_anomaly_hunt"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .knownMetalControl: return "Known metal control"
        case .openGrassControl: return "Open grass control"
        case .parkGridSurvey: return "Park/grid survey"
        case .roadFootpathSurvey: return "Road/footpath survey"
        case .oldIndustrialSite: return "Old industrial site"
        case .geologyBoundaryTest: return "Geology boundary test"
        case .manholeFenceControlObject: return "Manhole/fence/control object"
        case .unknownAnomalyHunt: return "Unknown anomaly hunt"
        }
    }
}

enum MountPosition: String, CaseIterable, Identifiable {
    case hand
    case backpack
    case woodenPole = "wooden_pole"
    case fixedMount = "fixed_mount"
    case carMount = "car_mount"
    case other

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .hand: return "Hand"
        case .backpack: return "Backpack"
        case .woodenPole: return "Wooden pole"
        case .fixedMount: return "Fixed mount"
        case .carMount: return "Car mount"
        case .other: return "Other"
        }
    }
}

enum SurveyPattern: String, CaseIterable, Identifiable {
    case freeWalk = "free_walk"
    case gridNorthSouth = "grid_north_south"
    case gridEastWest = "grid_east_west"
    case repeatLine = "repeat_line"
    case controlLoop = "control_loop"
    case roadTransect = "road_transect"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .freeWalk: return "Free walk"
        case .gridNorthSouth: return "Grid north-south"
        case .gridEastWest: return "Grid east-west"
        case .repeatLine: return "Repeat line"
        case .controlLoop: return "Control loop"
        case .roadTransect: return "Road transect"
        }
    }
}

enum SignalModuleOption: String, CaseIterable, Identifiable {
    case magnetometer
    case magnetometerBarometer = "magnetometer_barometer"
    case magnetometerMotion = "magnetometer_motion"
    case fullSensorPack = "full_iphone_sensor_pack"

    // Future modules — present in the vocabulary so stored data stays
    // forward-compatible, but not selectable in the v1 UI.
    case roadVibration = "road_vibration"
    case amConductivity = "am_radio_sdr_conductivity"
    case externalESP32 = "external_esp32_sensor"
    case cameraContext = "camera_context_photos"

    var id: String { rawValue }

    /// Modules the v1 UI actually offers.
    static var v1Selectable: [SignalModuleOption] {
        [.magnetometer, .magnetometerBarometer, .magnetometerMotion, .fullSensorPack]
    }

    var displayName: String {
        switch self {
        case .magnetometer: return "Magnetometer"
        case .magnetometerBarometer: return "Magnetometer + Barometer"
        case .magnetometerMotion: return "Magnetometer + Motion"
        case .fullSensorPack: return "Full iPhone sensor pack"
        case .roadVibration: return "Road vibration (future)"
        case .amConductivity: return "AM radio / SDR conductivity (future)"
        case .externalESP32: return "External ESP32 sensor (future)"
        case .cameraContext: return "Camera context photos (future)"
        }
    }
}

enum ShareSetting: String, CaseIterable, Identifiable {
    case privateLocalOnly = "private_local_only"
    case shareAnonymised = "share_anonymised"
    case shareFullPrecision = "share_full_precision_gps"
    case researchContributor = "research_contributor_mode"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .privateLocalOnly: return "Private local only"
        case .shareAnonymised: return "Share anonymised survey"
        case .shareFullPrecision: return "Share full survey with precise GPS"
        case .researchContributor: return "Research contributor mode"
        }
    }

    var allowsUpload: Bool { self != .privateLocalOnly }
}

enum MarkerType: String, CaseIterable, Identifiable {
    case manhole
    case fence
    case pipeMarker = "pipe_marker"
    case bridge
    case metalObject = "metal_object"
    case openControlPoint = "open_control_point"
    case knownTarget = "known_target"
    case suspectedAnomaly = "suspected_anomaly"
    case possibleContamination = "possible_contamination"
    case photoTakenExternally = "photo_taken_externally"
    case roadDefect = "road_defect"
    case waterloggedGround = "waterlogged_ground"
    case oldIndustrialFeature = "old_industrial_feature"
    case note
    case other

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .manhole: return "Manhole"
        case .fence: return "Fence"
        case .pipeMarker: return "Pipe marker"
        case .bridge: return "Bridge"
        case .metalObject: return "Metal object"
        case .openControlPoint: return "Open control point"
        case .knownTarget: return "Known target"
        case .suspectedAnomaly: return "Suspected anomaly"
        case .possibleContamination: return "Possible contamination"
        case .photoTakenExternally: return "Photo taken externally"
        case .roadDefect: return "Road defect"
        case .waterloggedGround: return "Waterlogged ground"
        case .oldIndustrialFeature: return "Old industrial feature"
        case .note: return "Note"
        case .other: return "Other"
        }
    }
}

enum SyncStatus: String {
    case localOnly = "local_only"
    case notSynced = "not_synced"
    case pending
    case synced
    case failed
}

// MARK: - Scoring vocabularies

/// Classes the scorer may assign. Deliberately conservative: nothing here
/// claims geology, minerals, utilities, or safety.
enum LikelyClass: String, CaseIterable {
    case normalBackground = "normal_background"
    case possibleLocalAnomaly = "possible_local_anomaly"
    case likelyFerrousOrInfrastructure = "likely_ferrous_or_infrastructure"
    case likelyMotionOrPhoneNoise = "likely_motion_or_phone_noise"
    case poorGpsQuality = "poor_gps_quality"
    case insufficientData = "insufficient_data"

    var displayName: String {
        switch self {
        case .normalBackground: return "Normal background"
        case .possibleLocalAnomaly: return "Possible local anomaly"
        case .likelyFerrousOrInfrastructure: return "Likely ferrous / infrastructure"
        case .likelyMotionOrPhoneNoise: return "Likely motion / phone noise"
        case .poorGpsQuality: return "Poor GPS quality"
        case .insufficientData: return "Insufficient data"
        }
    }
}

/// Quality flags attached to individual samples. Every low-quality reading
/// must carry at least one flag explaining why.
enum QualityFlag: String {
    case gpsMissing = "gps_missing"
    case gpsAccuracyPoor = "gps_accuracy_poor"
    case gpsStale = "gps_stale"
    case insufficientBaseline = "insufficient_baseline"
    case motionUnstable = "motion_unstable"
    case speedTooHigh = "speed_too_high"
    case singleSampleSpike = "single_sample_spike"
    case magnetometerUnavailable = "magnetometer_unavailable"
    case barometerUnavailable = "barometer_unavailable"
    case orientationUnstable = "orientation_unstable"
    case mockSensorData = "mock_sensor_data"
}
