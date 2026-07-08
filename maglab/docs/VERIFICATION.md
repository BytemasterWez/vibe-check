# MagLab Phase 1–3 Verification Status

Honest gate tracking. Nothing below claims more than what was actually
executed. Last updated: 2026-07-08 (verification pass on branch
`claude/maglab-field-network-9en6pq`).

## Status board

| Gate | Status | Evidence |
|---|---|---|
| Build scaffold | ✅ COMPLETE | 65-file monorepo committed |
| Phases 1–3 implementation | ✅ COMPLETE | ios/ sources |
| Backend contract | 🧱 STUBBED (by design) | Phase 7 gate |
| Scoring-spine compile + tests (Swift 6, Linux) | ✅ PROVEN | 24/24 XCTests pass via `tools/verify_scoring_linux.sh` |
| Syntax of all iOS sources | ✅ PROVEN | `swiftc -parse` clean over every file |
| Full app compile (SwiftUI/SwiftData/CoreMotion) | ✅ PROVEN | CI `ios-simulator` job, `xcodebuild` on macos-15, Xcode default toolchain |
| XcodeGen project generation | ✅ PROVEN | CI `ios-simulator` job generates `MagLab.xcodeproj` cleanly |
| XCTest suite on iOS simulator | ✅ PROVEN | `** TEST SUCCEEDED **`, 24/24 on iPhone 16 simulator (CI run 28978043491) |
| Simulator mock *interactive* flow (manual UI) | ⬜ NOT YET PROVEN | XCTests are logic/pipeline, not UI-driving; needs a manual run or XCUITest |
| Real sensor verification | ⬜ NOT YET PROVEN | requires iPhone |
| Field signal verification | ⬜ NOT YET PROVEN | FIELD_TEST_PROTOCOL.md |

**Decision standing: VERIFY BEFORE EXPANDING. The app now compiles and its
tests pass on a simulator in CI. Still required before Phase 4+: a manual
simulator run of the interactive flow (create → record → pause → save →
persists → detail opens) and the real-device control tests.**

## Continuous verification (CI)

`.github/workflows/maglab-verify.yml` runs on every push touching `maglab/`:

- **core-logic-linux** — the Linux scoring harness (24 tests + parse pass).
- **backend-tests** — FastAPI `pytest` (2/2).
- **ios-simulator** (macos-15) — `xcodegen generate` + `xcodebuild test`
  on an iPhone 16 simulator. First green run: 28978043491 (2026-07-08),
  full app compiled and 24/24 XCTests passed.

## What was executed and passed (Linux, Swift 6.0.3, Docker)

`tools/verify_scoring_linux.sh` assembles a SwiftPM package from the
**actual iOS sources** — all five data models (SwiftData macros stripped;
the logic under test is otherwise byte-identical), the entire Scoring/
layer, SensorSnapshot, SignalModule, MockSensorManager, Formatters — and
runs the real XCTest suites:

- `ScoringTests` (21 tests): magnetic total, rolling median/trimmed mean,
  residuals, GPS/motion quality, score threshold bands, single-spike
  penalty, confidence penalties, insufficient baseline, missing
  magnetometer, Core ML placeholder fallback. **21/21 pass.**
- `MockPipelineTests` (3 tests): the recording-loop pipeline (mock
  snapshot → fused sample → scorer) over a simulated 35 s walk —
  baseline warm-up reports `insufficient_data` honestly, a planted target
  pushes the score past the anomaly threshold with confidence ≥ 0.5 and no
  spike flag, and open ground between targets stays below 40. Mock
  snapshots are complete and deterministic (repeat runs produce identical
  readings). **3/3 pass.**
- `swiftc -parse` over every iOS source file (views, RecordingEngine,
  SensorManager, app entry included): no syntax errors.

Backend: `pytest` 2/2 pass (`/health` live, Phase 7 routes correctly 501).
`project.yml` parses as valid YAML.

## Defects found and fixed during this pass

1. **Mock walk started on top of a planted target.** The nearest-target
   rounding put an anomaly at 0 m, so the baseline would have warmed up on
   contaminated ground in the simulator. Targets now sit mid-interval
   (20 m, 60 m, …).
2. **Mock anomaly width caused phantom "shadow anomalies."** A σ = 5 m
   bump elevated >50% of the rolling-baseline window, dragging the median
   up and producing a false high score (49) on quiet ground after the
   pass — caught by `MockPipelineTests`. Width reduced to σ = 2.5 m
   (realistic for ferrous street furniture), documented in code, since the
   median's breakdown point is a real constraint the field protocol also
   relies on.

Note for field work: the same shadow effect can appear in reality when an
anomalous zone is wide relative to ~28 m of walk (window 100 samples at
5 Hz × 1.4 m/s). Wide made-ground areas will suppress their own residuals
— one more reason repeat runs and controls matter.

## Now proven by the macOS CI job

The `ios-simulator` job compiles the whole app with the real Apple SDKs, so
the items the Linux harness could not reach are now covered:

- SwiftUI view compilation and navigation (HomeView → NewSurvey →
  LiveRecording → SurveyDetail).
- SwiftData `@Model` macro expansion and ModelContainer schema (schema
  builds; the test host boots with it).
- RecordingEngine, SensorManager and every Core Location / Core Motion
  call site type-check against the frameworks.
- XcodeGen project generation and Info.plist privacy strings.

## Still NOT proven by any automation

- **Interactive runtime behaviour.** The XCTests are logic/pipeline tests,
  not UI-driving. Nothing yet exercises the live flow — permission prompts,
  the Timer sampling loop actually ticking, pause/resume state, records
  appearing in Home/Detail. Compiling ≠ behaving.
- Real sensor data and field signal (needs an iPhone).

## Next step

1. **Manual simulator run** (Mac): `cd maglab/ios && xcodegen generate &&
   open MagLab.xcodeproj`, then run and walk the flow — create survey,
   record in mock mode, watch the score rise ~14 s in (target at 20 m),
   pause/resume, stop/save, confirm it persists and detail opens.
   (Optional hardening: add an XCUITest so CI covers this too.)
2. Real iPhone gate (see FIELD_TEST_PROTOCOL.md):
   - stationary table baseline 2–3 min: stable total, low residual, no
     repeated false high-confidence anomalies;
   - known metal object, 3 slow passes: score rises near it, sane flags,
     marker saves, survey persists;
   - open grass control: no persistent high-confidence anomaly.

Only after all three: proceed to Phase 4.
