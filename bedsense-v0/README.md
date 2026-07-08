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
(including non-clinical wording checks) and the evidence report generator.

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
