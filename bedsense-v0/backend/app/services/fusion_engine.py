"""Deterministic sensor fusion engine (spec §12).

Consumes a rolling window of readings and produces one bed state per tick.
Pure rules — no ML, no clinical logic. The AI explanation layer never
overrides anything decided here.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np

from ..config import settings
from . import signal_quality as sq


@dataclass
class ReadingsWindow:
    """Rolling window (default last 10 s) of the metrics fusion cares about."""

    pressure_occupancy: list[float] = field(default_factory=list)
    pressure_value: list[float] = field(default_factory=list)
    radar_occupancy: list[float] = field(default_factory=list)
    radar_motion: list[float] = field(default_factory=list)
    radar_micro_motion: list[float] = field(default_factory=list)
    breathing_like: list[float] = field(default_factory=list)
    pressure_last_ts: datetime | None = None
    radar_last_ts: datetime | None = None
    pressure_reported_quality: float | None = None
    radar_reported_quality: float | None = None


def _mean(values: list[float]) -> float | None:
    return float(np.mean(values)) if values else None


class FusionEngine:
    def __init__(
        self,
        occupancy_threshold: float | None = None,
        empty_threshold: float | None = None,
        breathing_threshold: float | None = None,
        bed_exit_confirmation_seconds: int | None = None,
    ) -> None:
        self.occupancy_threshold = occupancy_threshold or settings.occupancy_threshold
        self.empty_threshold = empty_threshold or settings.occupancy_empty_threshold
        self.breathing_threshold = breathing_threshold or settings.breathing_like_threshold
        self.exit_confirm_s = (
            bed_exit_confirmation_seconds or settings.bed_exit_confirmation_seconds
        )
        # Cross-tick state needed for bed-exit confirmation.
        self.prev_occupied: bool | None = None
        self.below_since: datetime | None = None
        self.pending_exit: bool = False
        self.exit_confirmed: bool = False

    def reset(self) -> None:
        self.prev_occupied = None
        self.below_since = None
        self.pending_exit = False
        self.exit_confirmed = False

    def step(self, window: ReadingsWindow, now: datetime | None = None) -> dict:
        now = now or datetime.now(timezone.utc)

        pressure_occ = _mean(window.pressure_occupancy[-3:])
        radar_occ = _mean(window.radar_occupancy[-3:])
        radar_motion = _mean(window.radar_motion[-3:])
        radar_motion_peak = max(window.radar_motion) if window.radar_motion else None
        breathing = _mean(window.breathing_like[-5:])
        pressure_std = (
            float(np.std(window.pressure_value)) if len(window.pressure_value) >= 3 else None
        )

        # ---- Signal quality -------------------------------------------------
        sensor_scores = []
        pressure_q = radar_q = None
        if window.pressure_occupancy or window.pressure_value:
            pressure_q = sq.score_sensor_window(
                {
                    "occupancy_score": window.pressure_occupancy,
                    "pressure_value": window.pressure_value,
                },
                window.pressure_last_ts,
                window.pressure_reported_quality,
                now,
            )
            sensor_scores.append(pressure_q)
        if window.radar_motion or window.radar_occupancy:
            radar_q = sq.score_sensor_window(
                {
                    "occupancy_score": window.radar_occupancy,
                    "radar_motion_score": window.radar_motion,
                    "breathing_like_score": window.breathing_like,
                },
                window.radar_last_ts,
                window.radar_reported_quality,
                now,
            )
            sensor_scores.append(radar_q)

        conflict = sq.detect_conflict(pressure_occ, radar_occ)
        quality_score, quality_state = sq.combine_quality(sensor_scores, conflict)

        # ---- Occupancy ------------------------------------------------------
        occupied: bool | None
        if (pressure_occ is not None and pressure_occ >= self.occupancy_threshold) or (
            radar_occ is not None and radar_occ >= self.occupancy_threshold
        ):
            occupied = True
        elif (
            pressure_occ is not None
            and pressure_occ < self.empty_threshold
            and radar_occ is not None
            and radar_occ < self.empty_threshold
        ):
            occupied = False
        elif pressure_occ is None and radar_occ is None:
            occupied = None
        else:
            occupied = None  # in between / partial data: reduced confidence

        # ---- Movement -------------------------------------------------------
        if occupied is False:
            movement_state = "empty"
        elif occupied is None:
            movement_state = "unknown"
        elif radar_motion is not None and radar_motion >= 0.70:
            movement_state = "active_movement"
        elif radar_motion is not None and radar_motion >= 0.30:
            movement_state = "low_movement"
        elif (
            radar_motion is not None
            and radar_motion < 0.30
            and (pressure_std is None or pressure_std < 0.05)
        ):
            movement_state = "still"
        else:
            movement_state = "unknown"

        # ---- Breathing-like -------------------------------------------------
        breathing_detected: bool | None
        if (
            occupied is True
            and movement_state in ("still", "low_movement")
            and breathing is not None
            and breathing >= self.breathing_threshold
            and quality_state != "poor"
        ):
            breathing_detected = True
        elif (
            occupied is True
            and movement_state == "still"
            and breathing is not None
            and breathing < 0.30
        ):
            breathing_detected = False
        else:
            breathing_detected = None

        # ---- Bed exit tracking ---------------------------------------------
        transitions: list[str] = []
        # Spec §12 keys the exit on the *current* occupancy sample dropping,
        # so use the latest reading here rather than the window mean.
        pressure_occ_latest = (
            window.pressure_occupancy[-1] if window.pressure_occupancy else None
        )
        radar_occ_latest = window.radar_occupancy[-1] if window.radar_occupancy else None
        occ_below = (
            pressure_occ_latest is not None
            and pressure_occ_latest < self.empty_threshold
            and (radar_occ_latest is None or radar_occ_latest < self.occupancy_threshold)
        )
        motion_spiked = radar_motion_peak is not None and radar_motion_peak >= 0.70

        if self.prev_occupied is True and occ_below and motion_spiked and not self.pending_exit:
            self.pending_exit = True
            self.exit_confirmed = False
            self.below_since = now
            transitions.append("possible_bed_exit")
        elif self.pending_exit and not self.exit_confirmed:
            if not occ_below:
                self.pending_exit = False  # they came back / false alarm
                self.below_since = None
            elif (
                self.below_since is not None
                and (now - self.below_since).total_seconds() >= self.exit_confirm_s
            ):
                self.exit_confirmed = True
                transitions.append("bed_exit")

        if occupied is True:
            self.pending_exit = False
            self.exit_confirmed = False
            self.below_since = None

        # ---- Bed-exit risk ----------------------------------------------------
        pressure_trend_down = (
            len(window.pressure_occupancy) >= 4
            and _mean(window.pressure_occupancy[-2:]) is not None
            and _mean(window.pressure_occupancy[:2]) is not None
            and _mean(window.pressure_occupancy[-2:]) < _mean(window.pressure_occupancy[:2]) - 0.10
        )
        if self.pending_exit and not self.exit_confirmed:
            bed_exit_risk = "high"
        elif occupied is True and movement_state == "active_movement" and pressure_trend_down:
            bed_exit_risk = "medium"
        elif occupied is None and quality_state in ("missing", "poor"):
            bed_exit_risk = "unknown"
        else:
            bed_exit_risk = "low"

        # ---- Overall state ----------------------------------------------------
        if conflict:
            overall_state = "sensor_uncertain"
        elif self.exit_confirmed and "bed_exit" in transitions:
            overall_state = "exited_bed"
        elif self.pending_exit and not self.exit_confirmed:
            # Occupancy is often mid-drop (occupied=None) during the exit
            # transition, so this outranks the plain occupancy branches.
            overall_state = "possible_bed_exit"
        elif occupied is True:
            if self.prev_occupied is False:
                overall_state = "entered_bed"
            elif movement_state == "active_movement":
                overall_state = "occupied_moving"
            elif movement_state in ("still", "low_movement"):
                if breathing_detected is True:
                    overall_state = "occupied_still_breathing_like"
                elif breathing_detected is False:
                    overall_state = "occupied_still_no_breathing_like"
                else:
                    overall_state = "unknown"
            else:
                overall_state = "unknown"
        elif occupied is False:
            overall_state = "bed_empty"
        else:
            overall_state = "sensor_uncertain" if sensor_scores else "unknown"

        # ---- Confidence ---------------------------------------------------------
        margins = []
        for occ in (pressure_occ, radar_occ):
            if occ is not None:
                margins.append(min(abs(occ - self.occupancy_threshold), 0.35) / 0.35)
        margin = float(np.mean(margins)) if margins else 0.0
        confidence = round(0.2 + 0.5 * quality_score + 0.3 * margin, 3)
        if occupied is None or conflict:
            confidence = round(confidence * 0.5, 3)

        source_summary = {
            "pressure_occupancy": _round(pressure_occ),
            "radar_occupancy": _round(radar_occ),
            "radar_motion": _round(radar_motion),
            "radar_motion_peak": _round(radar_motion_peak),
            "breathing_like_score": _round(breathing),
            "pressure_std": _round(pressure_std),
            "pressure_quality": pressure_q,
            "radar_quality": radar_q,
            "conflict": conflict,
        }

        self.prev_occupied = occupied if occupied is not None else self.prev_occupied

        return {
            "timestamp_utc": now,
            "occupied": occupied,
            "movement_state": movement_state,
            "breathing_like_detected": breathing_detected,
            "bed_exit_risk": bed_exit_risk,
            "overall_state": overall_state,
            "confidence_score": max(0.0, min(1.0, confidence)),
            "signal_quality": quality_state,
            "quality_score": quality_score,
            "source_summary": source_summary,
            "transitions": transitions,
        }


def _round(v: float | None) -> float | None:
    return None if v is None else round(v, 3)
