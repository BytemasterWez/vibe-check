# MagLab — Signal-of-Opportunity Field Network

MagLab is a pocket geophysics and signal-of-opportunity logging platform.
It turns ordinary consumer sensors — starting with the iPhone
magnetometer, GPS, motion sensors and barometer — into a disciplined
field-logging system for mapping repeatable local physical anomalies.

The edge:

```
Boring physical input
  → AI/code/signal processing
  → structured proprietary field data
  → repeatable anomaly intelligence
```

The moat is not the app UI. The moat is the structured dataset: repeated
field runs, known-target labels, false-positive labels, magnetic
signatures, route geometry, quality scores, repeatability scores and —
eventually — correlation with public geology/infrastructure/old-map
layers.

## What MagLab is

- an iPhone sensor logger,
- a magnetic anomaly mapper,
- a repeatability engine,
- a labelled field-data collector,
- a citizen-science style survey app,
- an optional multi-user data network,
- a database-backed anomaly library.

## What MagLab is not (non-negotiable)

MagLab is **not** a professional geophysical survey instrument, utility
locator, excavation safety tool, mineral detector, pipe-confirmation
tool, legal survey tool, or guaranteed geology identifier. It never
displays claims like "ore found", "pipe confirmed", "safe to dig",
"utility detected", "mineral deposit identified" or "bedrock confirmed".
The strongest acceptable claim in v1 is:

> "Repeatable local magnetic anomaly detected with confidence X."

## Repository layout

```
maglab/
  ios/        SwiftUI iPhone app (local-first; Phases 1–3 implemented)
  backend/    FastAPI + Postgres/PostGIS sync service (Phase 7 skeleton)
  analysis/   DuckDB/Parquet pull + anomaly-library scripts (Phase 9 stubs)
  docs/       this file + protocol, dictionary, privacy, API, deployment
```

## Development phases

| Phase | Deliverable | Status |
|-------|-------------|--------|
| 1 | iOS skeleton: navigation, models, persistence, mock mode | ✅ implemented |
| 2 | Live sensor logging (mag/GPS/motion/barometer) | ✅ implemented |
| 3 | Live rule-based scoring + Live Recording UI | ✅ implemented |
| 4 | MapKit route, coloured track, markers, replay | ⏳ next |
| 5 | CSV / GeoJSON / survey-package exports | ⏳ |
| 6 | Anomaly event clustering + repeatability engine | ⏳ |
| 7 | Backend sync (FastAPI, PostGIS, Docker, token auth) | 🧱 skeleton only |
| 8 | Contributor mode (invite codes, consent, upload modes) | ⏳ |
| 9 | Analysis scripts (DuckDB, Parquet, anomaly library) | 🧱 stubs only |

**Hard gate:** phases 4+ wait until Phases 1–3 are verified on a real
iPhone using `FIELD_TEST_PROTOCOL.md`. The backend must never be required
for local use.

## Model strategy

- **v1 (now):** rule-based calibrated anomaly scorer — transparent thresholds,
  explicit confidence penalties. A Core ML placeholder exists but nothing
  blocks on it.
- **v2:** tabular classifier trained on labelled survey data.
- **v3:** context-aware model using public geology/infrastructure/old-map layers.
- **v4:** multi-signal model (magnetometer + motion + barometer + road
  vibration + external sensors).

No model is ever trained for "mineral found" or "geology confirmed".

## Quick start

- iOS app: see `../ios/README.md` (simulator works immediately in mock mode).
- Backend skeleton: see `../backend/README.md` and `DEPLOYMENT.md`.
- Field testing: `FIELD_TEST_PROTOCOL.md`.
- Data formats: `DATA_DICTIONARY.md`; API surface: `API_SPEC.md`.
- Privacy: `PRIVACY_AND_CONSENT.md` — local-only by default, no hidden
  uploads, no covert tracking, ever.

## Final target system

```
Contributor iPhones
  → MagLab app → local surveys
  → optional consent-based upload
  → FastAPI backend → Postgres/PostGIS
  → admin export → DuckDB / Parquet / GeoJSON
  → training dataset → future Core ML anomaly model
```

The real product is the growing labelled database of physical-world
anomalies collected through cheap sensors, repeatable protocols and
AI-assisted analysis.
