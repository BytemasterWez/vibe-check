"""Prototype event wording and severity (spec §14).

These are prototype events, not clinical alerts. Wording deliberately avoids
any medical or emergency language.
"""
from datetime import datetime

EVENT_RULES: dict[str, dict] = {
    "bed_entry": {
        "severity": "info",
        "title": "Prototype event detected: bed entry",
        "description": (
            "Prototype sensors registered a rise in pressure and occupancy "
            "scores consistent with a person entering the bed."
        ),
    },
    "bed_empty": {
        "severity": "info",
        "title": "Prototype event detected: bed empty",
        "description": "Prototype sensors report low occupancy scores; the bed appears empty.",
    },
    "bed_exit": {
        "severity": "medium",
        "title": "Prototype event detected: bed exit",
        "description": (
            "Occupancy scores stayed below the empty threshold for the "
            "configured confirmation window after a motion spike. The "
            "prototype classified this as a bed exit."
        ),
    },
    "possible_bed_exit": {
        "severity": "medium",
        "title": "Prototype event detected: possible bed exit",
        "description": (
            "Pressure occupancy dropped sharply after a radar motion spike. "
            "The prototype is watching for a confirmed bed exit."
        ),
    },
    "movement_detected": {
        "severity": "low",
        "title": "Prototype event detected: movement",
        "description": "Radar motion score crossed the active-movement threshold.",
    },
    "stillness_detected": {
        "severity": "info",
        "title": "Prototype event detected: stillness",
        "description": "Movement settled below the stillness threshold while the bed is occupied.",
    },
    "breathing_like_detected": {
        "severity": "info",
        "title": "Prototype event detected: breathing-like motion",
        "description": (
            "Breathing-like motion detected by prototype sensors: the "
            "breathing-like score stayed above the configured threshold "
            "while the occupant was still."
        ),
    },
    "breathing_like_not_detected": {
        "severity": "review",
        "title": "Breathing-like motion not detected by prototype sensors",
        "description": (
            "The occupant appears still but the breathing-like score stayed "
            "below the configured threshold. Review signal quality. This is "
            "a prototype observation, not a clinical alarm."
        ),
    },
    "signal_quality_warning": {
        "severity": "review",
        "title": "Review signal quality",
        "description": (
            "One or more prototype sensors are reporting poor or missing "
            "signal quality. Detection results may be unreliable until this clears."
        ),
    },
    "sensor_conflict": {
        "severity": "review",
        "title": "Prototype sensor conflict",
        "description": (
            "Sensors disagree about occupancy (for example pressure reads "
            "empty while radar reads strong presence). Review sensor "
            "placement and signal quality."
        ),
    },
    "manual_note": {
        "severity": "info",
        "title": "Manual note",
        "description": "Manual note added by the operator.",
    },
    "test_marker": {
        "severity": "info",
        "title": "Test marker",
        "description": "Manual test marker added by the operator.",
    },
}


def build_event(event_type: str, state: dict, now: datetime) -> dict:
    rule = EVENT_RULES[event_type]
    return {
        "timestamp_utc": now,
        "event_type": event_type,
        "severity": rule["severity"],
        "confidence_score": state.get("confidence_score"),
        "title": rule["title"],
        "description": rule["description"],
        "evidence": {
            "overall_state": state.get("overall_state"),
            "movement_state": state.get("movement_state"),
            "signal_quality": state.get("signal_quality"),
            "source_summary": state.get("source_summary"),
        },
    }
