"""CableLight BedSense V0 — API entrypoint.

Non-clinical research demonstrator for camera-less bed occupancy, movement
and breathing-like motion detection. Local-only: no cloud, camera or
microphone dependencies.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from .api import (
    routes_events,
    routes_experiments,
    routes_mock,
    routes_readings,
    routes_reports,
    routes_risk,
    routes_sensors,
    routes_settings,
    routes_state,
)
from .config import BOUNDARY_STATEMENT, VERSION, settings
from .database import SessionLocal, init_db
from .models import RiskRegisterEntry, Sensor
from .worker import runtime

logging.basicConfig(level=logging.INFO)

DEFAULT_SENSORS = [
    {"name": "Mock pressure mat", "sensor_type": "mock_pressure", "location": "under mattress", "status": "mock"},
    {"name": "Mock mmWave radar", "sensor_type": "mock_radar", "location": "headboard", "status": "mock"},
]

SEED_RISKS = [
    {
        "risk_title": "False negative: bed exit missed while sensors degraded",
        "risk_category": "false_negative",
        "description": "A real bed exit could be missed if pressure or radar quality drops during the transition.",
        "possible_cause": "Sensor fault, stale data, thresholds tuned too high.",
        "impact": "Prototype fails to log a bed-exit event during testing.",
        "mitigation": "Signal quality warnings, sensor conflict events, evidence review after each test session.",
        "status": "open",
    },
    {
        "risk_title": "User misunderstanding: prototype mistaken for a medical monitor",
        "risk_category": "user_misunderstanding",
        "description": "A reviewer could assume the demonstrator monitors health or replaces observation.",
        "possible_cause": "Dashboard language read out of context.",
        "impact": "Scope creep and inappropriate reliance on prototype output.",
        "mitigation": "Boundary statement on every report, non-clinical wording rules, prototype status shown on dashboard.",
        "status": "open",
    },
    {
        "risk_title": "False positive: restless movement flagged as bed exit",
        "risk_category": "false_positive",
        "description": "Large position shifts can momentarily drop pressure occupancy and spike radar motion.",
        "possible_cause": "Confirmation window too short.",
        "impact": "Noisy event timeline; testers lose trust in events.",
        "mitigation": "15-second bed-exit confirmation window; pending exits cancel when occupancy returns.",
        "status": "open",
    },
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    _seed()
    await runtime.start()
    yield
    await runtime.shutdown()


def _seed() -> None:
    db = SessionLocal()
    try:
        if not db.execute(select(Sensor).limit(1)).scalar_one_or_none():
            for s in DEFAULT_SENSORS:
                db.add(Sensor(**s))
        if not db.execute(select(RiskRegisterEntry).limit(1)).scalar_one_or_none():
            for r in SEED_RISKS:
                db.add(RiskRegisterEntry(**r))
        db.commit()
    finally:
        db.close()


app = FastAPI(
    title="CableLight BedSense V0",
    description=BOUNDARY_STATEMENT,
    version=VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # local-only prototype; dashboard runs on another local port
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "local_only": settings.local_only, "version": VERSION}


@app.get("/")
def root():
    return {
        "name": "CableLight BedSense V0",
        "boundary": BOUNDARY_STATEMENT,
        "version": VERSION,
        "docs": "/docs",
    }


for module in (
    routes_sensors,
    routes_readings,
    routes_state,
    routes_events,
    routes_experiments,
    routes_mock,
    routes_reports,
    routes_risk,
    routes_settings,
):
    app.include_router(module.router)
