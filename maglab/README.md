# MagLab — Signal-of-Opportunity Field Network

Pocket geophysics: a local-first iPhone app that turns consumer sensors
(magnetometer, GPS, motion, barometer) into a disciplined field-logging
system for mapping **repeatable** local magnetic anomalies — plus an
optional consent-based backend for aggregating contributor surveys into a
labelled analysis database.

**Start here: [`docs/README.md`](docs/README.md)** — philosophy, phase
status, model strategy.

```
ios/       SwiftUI app — Phases 1–3 implemented (build with XcodeGen, see ios/README.md)
backend/   FastAPI + PostGIS sync service — Phase 7 skeleton (health endpoint live)
analysis/  DuckDB/Parquet/anomaly-library scripts — Phase 9 stubs
docs/      README, FIELD_TEST_PROTOCOL, DATA_DICTIONARY,
           PRIVACY_AND_CONSENT, API_SPEC, DEPLOYMENT
```

Ground rules baked into the code: local-only and private by default, no
hidden uploads, no covert tracking, a single spike is never proof, and the
app never claims geology, minerals, utilities or dig-safety — the
strongest claim is *"repeatable local magnetic anomaly detected with
confidence X."*
