"""Event detection from consecutive fused bed states (spec §14).

Compares the previous and current fusion result and emits prototype events.
Wording and severity come from alert_rules — never clinical language.
"""
from datetime import datetime, timezone

from .alert_rules import build_event


class EventDetector:
    #: neutral stand-in for the first tick so initial-state events still fire
    _NEUTRAL_PREV = {
        "occupied": None,
        "movement_state": "unknown",
        "breathing_like_detected": None,
    }

    def __init__(self) -> None:
        self.prev: dict | None = None
        self._last_definite_occupied: bool | None = None
        self._last_quality_warning_at: datetime | None = None
        self._last_conflict_at: datetime | None = None

    def reset(self) -> None:
        self.prev = None
        self._last_definite_occupied = None
        self._last_quality_warning_at = None
        self._last_conflict_at = None

    def detect(self, state: dict, now: datetime | None = None) -> list[dict]:
        now = now or state.get("timestamp_utc") or datetime.now(timezone.utc)
        events: list[dict] = []
        prev = self.prev

        # Bed-exit transitions come straight from the fusion engine.
        for transition in state.get("transitions", []):
            if transition == "possible_bed_exit":
                events.append(build_event("possible_bed_exit", state, now))
            elif transition == "bed_exit":
                events.append(build_event("bed_exit", state, now))

        if prev is None:
            prev = self._NEUTRAL_PREV

        # Occupancy passes through None mid-transition, so entry/empty events
        # key off the last *definite* occupancy value, not the previous tick.
        if state.get("occupied") is True and self._last_definite_occupied is False:
            events.append(build_event("bed_entry", state, now))
        if (
            state.get("occupied") is False
            and self._last_definite_occupied is not False
            and not state.get("transitions")
            and state.get("overall_state") == "bed_empty"
        ):
            events.append(build_event("bed_empty", state, now))

        prev_move, cur_move = prev.get("movement_state"), state.get("movement_state")
        if cur_move == "active_movement" and prev_move != "active_movement":
            events.append(build_event("movement_detected", state, now))
        if (
            cur_move == "still"
            and prev_move in ("active_movement", "low_movement")
            and state.get("occupied") is True
        ):
            events.append(build_event("stillness_detected", state, now))

        prev_breath = prev.get("breathing_like_detected")
        cur_breath = state.get("breathing_like_detected")
        if cur_breath is True and prev_breath is not True:
            events.append(build_event("breathing_like_detected", state, now))
        if cur_breath is False and prev_breath is not False:
            events.append(build_event("breathing_like_not_detected", state, now))

        # Quality warnings, rate-limited so a bad patch doesn't flood the log.
        if state.get("signal_quality") in ("poor", "missing"):
            if self._cooldown_over(self._last_quality_warning_at, now):
                events.append(build_event("signal_quality_warning", state, now))
                self._last_quality_warning_at = now
        if state.get("signal_quality") == "conflicting":
            if self._cooldown_over(self._last_conflict_at, now):
                events.append(build_event("sensor_conflict", state, now))
                self._last_conflict_at = now

        self.prev = state
        if state.get("occupied") is not None:
            self._last_definite_occupied = state.get("occupied")
        return events

    @staticmethod
    def _cooldown_over(last: datetime | None, now: datetime, cooldown_s: float = 30.0) -> bool:
        return last is None or (now - last).total_seconds() >= cooldown_s
