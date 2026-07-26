"""Background runtime: mock data generation + fusion loop.

Runs inside the FastAPI process. Every tick it (a) reads samples from the
active mock/replay adapter if one is running, (b) fuses the rolling reading
window into a bed state, and (c) records any detected prototype events.

V0.1 session enforcement: nothing is written without a session. If mock data
starts with no active experiment session, a demo session named
DEMO_<scenario>_<timestamp> is auto-created; when the mock stops (or a
finite demo scenario completes) that session is finalized with computed
results, so every one-click demo produces a report-ready run.

`speed="fast"` compresses time for quick testing: ticks run 5x faster and
all time-based rules (rolling window, bed-exit confirmation, event
cooldowns) scale down by the same factor so behaviour is preserved.
"""
import asyncio
import contextlib
import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from .adapters.csv_replay_adapter import CsvReplayAdapter
from .adapters.mock_adapter import MOCK_SCENARIOS, MockBedSensorSet
from .config import settings
from .database import SessionLocal
from .models import BedState, Event, ExperimentSession, SensorReading
from .services.event_detector import EventDetector
from .services.experiment_logger import DEFAULT_EXPECTED, finalize_experiment
from .services.explanation_layer import explain_state
from .services.fusion_engine import FusionEngine, ReadingsWindow

logger = logging.getLogger("bedsense.worker")

SPEED_FACTORS = {"realtime": 1.0, "fast": 0.2}

# How long (simulated seconds) an auto-created demo session runs for
# scenarios that would otherwise generate data forever. Finite scenarios
# (person_enters_bed, bed_exit, composites) end via scenario_finished().
DEMO_DURATIONS_S: dict[str, int] = {
    "empty_bed": 30,
    "person_still": 45,
    "breathing_like_motion": 45,
    "person_moving": 30,
}

METRIC_UNITS = {
    "pressure_value": "normalized",
    "occupancy_score": "score",
    "radar_motion_score": "score",
    "radar_micro_motion_score": "score",
    "breathing_like_score": "score",
    "movement_score": "score",
}


class Runtime:
    def __init__(self) -> None:
        self.mock_running = False
        self.scenario: str | None = None
        self.speed = "realtime"
        self.mock_set: MockBedSensorSet | None = None
        self.replay: CsvReplayAdapter | None = None
        self.current_session_id: uuid.UUID | None = None
        self.current_session_name: str | None = None
        self.auto_session: bool = False
        self.fusion = FusionEngine()
        self.detector = EventDetector()
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    # ---- lifecycle -----------------------------------------------------
    async def start(self) -> None:
        self._stop.clear()
        self._task = asyncio.create_task(self._loop())

    async def shutdown(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    # ---- session binding -------------------------------------------------
    def bind_session(self, session_id: uuid.UUID, name: str) -> None:
        """Attach the runtime to an operator-started experiment session."""
        self.current_session_id = session_id
        self.current_session_name = name
        self.auto_session = False

    def unbind_session(self, session_id: uuid.UUID) -> None:
        if self.current_session_id == session_id:
            self.current_session_id = None
            self.current_session_name = None
            self.auto_session = False

    def _create_demo_session(self, scenario: str) -> None:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        db = SessionLocal()
        try:
            session = ExperimentSession(
                name=f"DEMO_{scenario}_{stamp}",
                scenario=scenario if scenario in DEFAULT_EXPECTED else "manual_test",
                operator_name="demo",
                notes="Auto-created demo session (mock started without an active session).",
                expected_events=DEFAULT_EXPECTED.get(scenario, []),
                started_at=datetime.now(timezone.utc),
            )
            db.add(session)
            db.commit()
            db.refresh(session)
            self.current_session_id = session.id
            self.current_session_name = session.name
            self.auto_session = True
            logger.info("auto-created demo session %s", session.name)
        finally:
            db.close()

    def _finalize_auto_session(self) -> None:
        if not self.auto_session or self.current_session_id is None:
            return
        db = SessionLocal()
        try:
            session = db.get(ExperimentSession, self.current_session_id)
            if session is not None:
                finalize_experiment(db, session)
                db.commit()
                logger.info("finalized demo session %s", session.name)
        finally:
            db.close()
        self.current_session_id = None
        self.current_session_name = None
        self.auto_session = False

    # ---- controls --------------------------------------------------------
    def start_mock(self, scenario: str = "empty_bed", speed: str = "realtime",
                   csv_file: str | None = None) -> dict:
        if csv_file or scenario == "csv_replay":
            replay = CsvReplayAdapter(csv_file or f"{settings.data_dir}/mock/normal_night.csv")
            if not replay.connect():
                raise FileNotFoundError(f"Replay file not found: {replay.csv_path}")
            self.replay = replay
            self.mock_set = None
            self.scenario = "csv_replay"
        else:
            if scenario not in MOCK_SCENARIOS:
                raise ValueError(f"Unknown scenario '{scenario}'. Choose from {MOCK_SCENARIOS}")
            self.mock_set = MockBedSensorSet(scenario)
            self.replay = None
            self.scenario = scenario

        # Session enforcement: never generate unscoped data. Re-starting the
        # mock while an auto demo session is live rolls into a fresh demo
        # session so each run stays cleanly separated.
        if self.auto_session:
            self._finalize_auto_session()
        if self.current_session_id is None:
            self._create_demo_session(self.scenario)

        self.speed = speed if speed in SPEED_FACTORS else "realtime"
        factor = SPEED_FACTORS[self.speed]
        self.fusion = FusionEngine(
            bed_exit_confirmation_seconds=max(1, int(settings.bed_exit_confirmation_seconds * factor))
        )
        self.detector.reset(cooldown_scale=factor)
        self.mock_running = True
        return self.status()

    def stop_mock(self) -> dict:
        self.mock_running = False
        self.scenario = None
        self.mock_set = None
        self.replay = None
        self._finalize_auto_session()
        return self.status()

    def status(self) -> dict:
        return {
            "mock_running": self.mock_running,
            "scenario": self.scenario,
            "speed": self.speed,
            "session_id": str(self.current_session_id) if self.current_session_id else None,
            "session_name": self.current_session_name,
            "auto_session": self.auto_session,
        }

    # ---- main loop ----------------------------------------------------------
    async def _loop(self) -> None:
        while not self._stop.is_set():
            factor = SPEED_FACTORS.get(self.speed, 1.0)
            interval = settings.fusion_interval_seconds * factor
            try:
                await asyncio.to_thread(self._tick, factor)
            except Exception:  # keep the loop alive through transient DB errors
                logger.exception("fusion tick failed")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=max(0.05, interval))
            except asyncio.TimeoutError:
                pass

    def _tick(self, factor: float) -> None:
        # Session enforcement: no session, no writes.
        if self.current_session_id is None:
            return
        db = SessionLocal()
        try:
            now = datetime.now(timezone.utc)
            if self.mock_running:
                self._generate_samples(db, now)
            if self.current_session_id is not None:
                self._fuse(db, now, factor)
            db.commit()
        finally:
            db.close()

    def _demo_finished(self) -> bool:
        if self.mock_set is None:
            return False
        if self.mock_set.scenario_finished():
            return True
        if self.auto_session:
            limit = DEMO_DURATIONS_S.get(self.scenario or "")
            return limit is not None and self.mock_set.radar.t >= limit
        return False

    def _generate_samples(self, db, now: datetime) -> None:
        samples: list[dict] = []
        if self.mock_set is not None:
            if self._demo_finished():
                logger.info("demo scenario '%s' complete; stopping mock", self.scenario)
                db.commit()  # persist everything written so far this tick
                self.stop_mock()
                return
            samples = self.mock_set.read_samples()
        elif self.replay is not None:
            if self.replay.finished():
                logger.info("CSV replay finished; stopping mock")
                db.commit()
                self.stop_mock()
                return
            samples = [self.replay.read_sample()]
        for sample in samples:
            for metric, value in sample["metrics"].items():
                db.add(
                    SensorReading(
                        timestamp_utc=now,
                        session_id=self.current_session_id,
                        sensor_type=sample["sensor_type"],
                        metric=metric,
                        value_float=float(value),
                        unit=METRIC_UNITS.get(metric, "score"),
                        quality_score=sample["quality"]["quality_score"],
                        raw_payload=sample["raw_payload"],
                    )
                )

    def _fuse(self, db, now: datetime, factor: float) -> None:
        window_s = settings.rolling_window_seconds * factor
        cutoff = now - timedelta(seconds=window_s)
        rows = db.execute(
            select(SensorReading)
            .where(
                SensorReading.timestamp_utc >= cutoff,
                SensorReading.session_id == self.current_session_id,
            )
            .order_by(SensorReading.timestamp_utc)
        ).scalars().all()
        if not rows:
            return  # nothing to fuse; stay silent rather than spamming unknowns

        window = ReadingsWindow()
        for r in rows:
            is_pressure = "pressure" in r.sensor_type
            is_radar = "radar" in r.sensor_type
            v = r.value_float
            if v is None:
                continue
            if r.metric == "occupancy_score" and is_pressure:
                window.pressure_occupancy.append(v)
            elif r.metric == "pressure_value":
                window.pressure_value.append(v)
            elif r.metric == "occupancy_score" and is_radar:
                window.radar_occupancy.append(v)
            elif r.metric == "radar_motion_score":
                window.radar_motion.append(v)
            elif r.metric == "radar_micro_motion_score":
                window.radar_micro_motion.append(v)
            elif r.metric == "breathing_like_score":
                window.breathing_like.append(v)
            if is_pressure:
                window.pressure_last_ts = r.timestamp_utc
                window.pressure_reported_quality = r.quality_score
            if is_radar:
                window.radar_last_ts = r.timestamp_utc
                window.radar_reported_quality = r.quality_score

        state = self.fusion.step(window, now)
        state["explanation"] = explain_state(state)

        db.add(
            BedState(
                timestamp_utc=now,
                session_id=self.current_session_id,
                occupied=state["occupied"],
                movement_state=state["movement_state"],
                breathing_like_detected=state["breathing_like_detected"],
                bed_exit_risk=state["bed_exit_risk"],
                overall_state=state["overall_state"],
                confidence_score=state["confidence_score"],
                signal_quality=state["signal_quality"],
                explanation=state["explanation"],
                source_summary=state["source_summary"],
            )
        )

        for event in self.detector.detect(state, now):
            db.add(
                Event(
                    timestamp_utc=event["timestamp_utc"],
                    session_id=self.current_session_id,
                    event_type=event["event_type"],
                    severity=event["severity"],
                    confidence_score=event["confidence_score"],
                    title=event["title"],
                    description=event["description"],
                    evidence=event["evidence"],
                )
            )


runtime = Runtime()
