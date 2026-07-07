# MagLab iOS app

SwiftUI app targeting iOS 17+. Phases 1–3 are implemented: survey
creation, local SwiftData persistence, live sensor logging (magnetometer,
GPS, motion, barometer), rolling-baseline residuals, and rule-based
anomaly scoring with confidence and quality flags. Mock sensor mode is
built in and always active in the simulator.

## Building

The Xcode project file is generated, not checked in.

**Option A — XcodeGen (recommended):**

```bash
brew install xcodegen
cd maglab/ios
xcodegen generate
open MagLab.xcodeproj
```

**Option B — manual:** create a new iOS App project named `MagLab`
(SwiftUI, iOS 17 minimum), delete the template `ContentView.swift`, drag the
`MagLab/` source folders into the app target and `MagLabTests/` into a unit
test target, then add these Info.plist keys to the app target:

- `NSLocationWhenInUseUsageDescription`
- `NSMotionUsageDescription`

## Running

- **Simulator:** works out of the box in mock sensor mode (the simulator has
  no magnetometer). The mock simulates a walk past buried ferrous targets
  every ~40 m, so the whole scoring pipeline can be exercised at a desk.
- **Device:** grant location and motion permissions when prompted. Toggle
  "Mock sensor mode" in Settings to develop indoors on a real phone; mock
  samples are always flagged `mock_sensor_data`.

## Tests

Run the `MagLabTests` scheme (⌘U). Coverage: magnetic total, rolling
median/trimmed-mean baseline, residuals, GPS/motion quality scoring, score
threshold bands, single-spike penalty, confidence penalties, degenerate
inputs (no magnetometer, insufficient baseline), and the Core ML
placeholder fallback.

## Source layout

```
MagLab/
  MagLabApp.swift        app entry + shared ModelContainer
  Models/                SwiftData models + controlled vocabularies
  Services/              SensorManager (real), MockSensorManager,
                         RecordingEngine, SurveyStore, SignalModule protocol
  Scoring/               ScoringConfig, RollingBaseline, QualityScoring,
                         RuleBasedAnomalyScorer, CoreMLAnomalyScorer (stub)
  Views/                 Home, NewSurvey, LiveRecording, SurveyDetail,
                         Settings, About/Safety
  Utilities/             display formatters
MagLabTests/             XCTest suite (separate target — XCTest cannot link
                         into the app target, so tests live beside MagLab/
                         rather than inside it)
```

## Field testing gate

Per the build brief: **do not start the backend until Phases 1–3 are
verified on a real iPhone** using `docs/FIELD_TEST_PROTOCOL.md` (known
metal control → open grass control → made-ground site).
