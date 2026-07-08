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
| Full app compile (SwiftUI/SwiftData/CoreMotion) | ⬜ NOT YET PROVEN | requires Xcode on macOS |
| Simulator mock flow | ⬜ NOT YET PROVEN | requires Xcode |
| Real sensor verification | ⬜ NOT YET PROVEN | requires iPhone |
| Field signal verification | ⬜ NOT YET PROVEN | FIELD_TEST_PROTOCOL.md |

**Decision standing: VERIFY BEFORE EXPANDING. No Phase 4+ work until the
Xcode build, simulator flow, and real-device control tests pass.**

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

## What Linux verification cannot prove

- SwiftUI view compilation and navigation (HomeView → NewSurvey →
  LiveRecording → SurveyDetail).
- SwiftData `@Model` macro expansion, ModelContainer schema, persistence
  and fetch behaviour.
- RecordingEngine's Timer loop, @MainActor isolation, pause/resume
  lifecycle, batched saves.
- Core Location/Core Motion permission flow and real sensor callbacks.
- XcodeGen project generation and Info.plist privacy strings.

## Next step (requires a Mac + iPhone)

1. `brew install xcodegen && cd maglab/ios && xcodegen generate && open MagLab.xcodeproj`
2. Simulator: build, run, create survey, record in mock mode, watch score
   rise ~14 s into the walk (target at 20 m), pause/resume, stop/save,
   confirm survey persists and detail opens. Run ⌘U (24 tests).
3. Real iPhone gate (see FIELD_TEST_PROTOCOL.md):
   - stationary table baseline 2–3 min: stable total, low residual, no
     repeated false high-confidence anomalies;
   - known metal object, 3 slow passes: score rises near it, sane flags,
     marker saves, survey persists;
   - open grass control: no persistent high-confidence anomaly.

Only after all three: proceed to Phase 4.
