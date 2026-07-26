"""Event detection from consecutive fused bed states (spec §14, V0.1 §3).

Compares the previous and current fusion result and emits prototype events.
Events are transition-based and rate-limited by per-type cooldown windows so
a flapping signal cannot spam the event log. Wording and severity come from
alert_rules — never clinical language.
"""
from datetime import datetime, timezone

from .alert_rules import build_event

# V0.1 hardening spec cooldown windows, in seconds. Events not listed
# (bed_entry, bed_empty, bed_exit) are pure one-shot transitions from the
# fusion engine and need no cooldown.
COOLDOWNS_S: dict[str, float] = {
    "breathing_like_detected": 300.0,
    "breathing_like_not_detected": 60.0,
    "movement_detected": 60.0,
    "stillness_detected": 300.0,
    "signal_quality_warning": 120.0,
    "sensor_conflict": 120.0,
    "possible_bed_exit": 15.0,  # dedupe window
}

# Opposite-pair events reset each other's cooldown: a genuine
# lost-then-restored breathing transition must fire even inside the
# 5-minute window, while flapping (True -> unknown -> True) stays suppressed.
RESETS: dict[str, str] = {
    "breathing_like_detected": "breathing_like_not_detected",
    "breathing_like_not_detected": "breathing_like_detected",
}


class EventDetector:
    #: neutral stand-in for the first tick so initial-state events still fire
    _NEUTRAL_PREV = {
        "occupied": None,
        "movement_state": "unknown",
        "breathing_like_detected": None,
    }

    def __init__(self, cooldown_scale: float = 1.0) -> None:
        # cooldown_scale compresses windows in fast-mode demos so behaviour
        # matches realtime (same scaling as the bed-exit confirmation).
        self.cooldown_scale = cooldown_scale
        self.prev: dict | None = None
        self._last_definite_occupied: bool | None = None
        self._last_fired: dict[str, datetime] = {}

    def reset(self, cooldown_scale: float | None = None) -> None:
        if cooldown_scale is not None:
            self.cooldown_scale = cooldown_scale
        self.prev = None
        self._last_definite_occupied = None
        self._last_fired = {}

    def _emit(self, events: list[dict], event_type: str, state: dict, now: datetime) -> None:
        cooldown = COOLDOWNS_S.get(event_type)
        if cooldown is not None:
            last = self._last_fired.get(event_type)
            if last is not None and (now - last).total_seconds() < cooldown * self.cooldown_scale:
                return
        events.append(build_event(event_type, state, now))
        self._last_fired[event_type] = now
        opposite = RESETS.get(event_type)
        if opposite:
            self._last_fired.pop(opposite, None)

    def detect(self, state: dict, now: datetime | None = None) -> list[dict]:
        now = now or state.get("timestamp_utc") or datetime.now(timezone.utc)
        events: list[dict] = []
        prev = self.prev if self.prev is not None else self._NEUTRAL_PREV

        # Bed-exit transitions come straight from the fusion engine.
        for transition in state.get("transitions", []):
            if transition == "possible_bed_exit":
                self._emit(events, "possible_bed_exit", state, now)
            elif transition == "bed_exit":
                # Once per confirmed exit — the fusion engine only raises this
                # transition a single time per exit cycle.
                events.append(build_event("bed_exit", state, now))

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
            self._emit(events, "movement_detected", state, now)
        if (
            cur_move == "still"
            and prev_move in ("active_movement", "low_movement")
            and state.get("occupied") is True
        ):
            self._emit(events, "stillness_detected", state, now)

        prev_breath = prev.get("breathing_like_detected")
        cur_breath = state.get("breathing_like_detected")
        if cur_breath is True and prev_breath is not True:
            self._emit(events, "breathing_like_detected", state, now)
        if cur_breath is False and prev_breath is not False:
            self._emit(events, "breathing_like_not_detected", state, now)

        if state.get("signal_quality") in ("poor", "missing"):
            self._emit(events, "signal_quality_warning", state, now)
        if state.get("signal_quality") == "conflicting":
            self._emit(events, "sensor_conflict", state, now)

        self.prev = state
        if state.get("occupied") is not None:
            self._last_definite_occupied = state.get("occupied")
        return events
