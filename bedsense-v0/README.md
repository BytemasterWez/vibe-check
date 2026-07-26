# CableLight BedSense V0

**Non-clinical research demonstrator for camera-less bed occupancy, movement and breathing-like motion detection.**

Part of the wider CableLight Vitals Bed concept.

> This prototype does **not** monitor health, diagnose, predict deterioration, replace
> medical devices, or support clinical decisions. It exists to prove one thing: that a
> low-cost bed module can detect presence, stillness, movement, breathing-like motion and
> bed-exit behaviour using modular sensors and explainable software fusion.

## What it does

- Simulates a pressure mat + mmWave-style radar with five mock scenarios
  (empty bed, person enters, still with breathing-like motion, moving, bed exit)
  plus composite sequences — **no physical sensors required**
- Replays recorded/synthetic CSV data through the same pipeline
- Fuses the rolling sensor window into one bed state per second with
  deterministic rules (no ML, no clinical logic)
- Scores signal quality (freshness, flatline, impossible values, noise, conflict)
- Emits explainable prototype events (bed entry/exit, movement, stillness,
  breathing-like detected/not detected, quality warnings, sensor conflicts)
- Runs experiment sessions with expected-vs-actual scoring (detection delay,
  false positives/negatives) and exports Markdown + CSV evidence packs
- Keeps a risk register for prototype testing

Privacy by construction: no camera, no microphone, no cloud, no accounts,
session IDs instead of identities, local-only database.

## V0.1 hardening

The demonstrator is evidence-clean by construction:

- **Session enforcement** — no reading, bed state or event can exist without a
  `session_id`. Manual `POST`s inherit the active session or are rejected with
  422; starting a mock with no session auto-creates `DEMO_<scenario>_<timestamp>`
  and finalizes it with computed results when the run completes.
- **Session-scoped dashboard** — every panel defaults to the active session, so
  a demo can never show stale state or events from an earlier scenario. A
  *Current session / All sessions* toggle exposes the unscoped view, which is
  labelled "Demo mode — unscoped data" when no session is active.
- **Transition-based events with cooldowns** — a held state updates the bed
  state every second but does not re-emit events. Cooldowns: breathing-like
  detected 5 min, breathing-like not detected 60 s, movement 60 s, stillness
  5 min, quality warning 2 min, sensor conflict 2 min, possible bed exit
  deduplicated within 15 s, bed exit once per confirmed exit. Opposite events
  (detected ↔ not detected) reset each other, so a genuine lost-then-restored
  transition still fires. In `fast` mode the windows scale with the clock.
- **Fusion confidence, not accuracy** — the score is labelled "fusion
  confidence" everywhere, and every report states that it is an internal
  prototype scoring measure, not clinical accuracy.
- **Reset demo data** — stops the mock, closes open sessions and clears orphan
  rows. Evidence reports are kept unless deletion is explicitly requested.
- **One-click demos** — `POST /demo/run` (or the Experiments page buttons) runs
  a scenario end to end in its own session, leaving a report-ready run.

## Quick start

Requires Docker + Docker Compose. No other dependencies.

```bash
docker compose up --build
```

- Dashboard: http://localhost:8090
- API + OpenAPI docs: http://localhost:8088/docs
- PostgreSQL: localhost:5438 (bedsense / bedsense)

Then open the dashboard → **Experiments** → start an experiment (e.g.
`T005_bed_exit_5min`, scenario `bed_exit`) → click **Run mock bed exit** →
watch the Dashboard update every second → **Stop experiment** →
**Export evidence report** → download from the **Reports** page.

Mock scenarios support `speed: "fast"` (5× compressed time, thresholds scale
to match) for quick runs.

## Repo layout

```
bedsense-v0/
  docker-compose.yml
  backend/            FastAPI + SQLAlchemy + fusion/rules engine
    app/adapters/     sensor adapters (mock, CSV replay, manual, hardware placeholders)
    app/services/     signal quality, fusion, event detection, alert wording,
                      experiment scoring, evidence reports, explanation layer
    app/api/          REST routes
    app/tests/        pytest suite
  frontend/           Next.js + Tailwind dashboard (6 screens)
  data/mock/          seeded replay CSVs for the five core scenarios
  evidence/           generated reports, exports, screenshots
```

## Key API endpoints

| Area | Endpoints |
|------|-----------|
| Health | `GET /health` |
| Sensors | `GET/POST /sensors`, `GET/PATCH /sensors/{id}` |
| Readings | `GET/POST /readings`, `POST /readings/bulk` |
| Bed state | `GET /state/current`, `GET /state/history` |
| Events | `GET/POST /events`, `PATCH /events/{id}/acknowledge` |
| Experiments | `GET /experiments`, `POST /experiments/start`, `POST /experiments/{id}/stop`, `POST /experiments/{id}/mark`, `PATCH /experiments/{id}/assess` |
| Mock | `POST /mock/start`, `POST /mock/stop`, `POST /mock/scenario`, `GET /mock/status` |
| Demo | `GET /demo/sequences`, `POST /demo/run`, `POST /demo/reset` |
| Reports | `POST /reports/evidence-pack`, `GET /reports`, `GET /reports/{id}`, `GET /reports/{id}/download/{kind}` |
| Risk register | `GET/POST /risk-register`, `PATCH /risk-register/{id}` |
| Settings | `GET/PATCH /settings` (local-only is locked true) |

## Running the backend tests

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest app/tests -q
```

The tests cover the mock adapter scenario patterns, signal quality scoring,
fusion rules (including the bed-exit confirmation window), event detection
(cooldowns, spam suppression and non-clinical wording), the evidence report
generator, and — through the real FastAPI app against a temporary SQLite
database — session enforcement, auto-created demo sessions, session-scoped
dashboard queries, demo reset and single-session evidence packs.

## Validation test matrix

V0.1 is the point to stop adding features and start collecting numbers. Run
each scenario repeatedly via the one-click demos, then fill this in from the
exported evidence packs:

| Scenario | Runs | Target | Actual | Pass? |
|----------|------|--------|--------|-------|
| Empty vs occupied | 10 | 95%+ | TBD | TBD |
| Moving vs still | 10 | 90%+ | TBD | TBD |
| Bed-exit detected | 10 | 90%+ | TBD | TBD |
| Breathing-like while still | 10 | 85%+ | TBD | TBD |
| Mixed sequence | 5 | qualitative | TBD | TBD |
| False-alert 60-min runs | 3 | record count | TBD | TBD |

## First test protocol (spec §20)

Create these sessions from the Experiments page and record results via
assess + evidence export:

| Session | Scenario | Expected |
|---------|----------|----------|
| T001_empty_bed_10min | empty_bed | stays `bed_empty`, no false events |
| T002_person_enters_bed_5min | person_enters_bed | `bed_entry` |
| T003_still_breathing_like_10min | person_still | `breathing_like_detected` |
| T004_movement_5min | person_moving | `movement_detected` |
| T005_bed_exit_5min | bed_exit | `possible_bed_exit` → `bed_exit` |
| T006_mixed_sequence_20min | mixed_sequence | entry → movement → exit chain |
| T007_false_alert_check_60min | person_still | record false-positive count |

## Scope boundary

Allowed description: *"Non-clinical research demonstrator for camera-less bed
occupancy, movement and breathing-like motion detection."*

This build intentionally excludes: hospital/FHIR/NHS integration, real patient
records, regulated medical claims, mobile apps, payments, cloud SaaS, real
vitals hardware integration, fall diagnosis, emergency alerting, clinical
workflows, and ML model training. The AI layer is explanation-only and never
overrides the deterministic rules engine.
