"""Explanation-only AI layer (spec §22) and synthetic scenario patterns (§21).

Produces short deterministic explanations of what the rules engine decided
and why. It never decides alerts and never overrides the rules engine.
No diagnosis, no treatment advice, no clinical scoring.
"""

STATE_TEMPLATES = {
    "bed_empty": (
        "The prototype classified the bed as empty because pressure and radar "
        "occupancy scores both stayed low."
    ),
    "entered_bed": (
        "The prototype classified this as a bed entry because pressure and "
        "occupancy scores rose sharply alongside a radar motion spike."
    ),
    "occupied_still_breathing_like": (
        "The prototype classified the bed as occupied and still because "
        "pressure remained stable and radar movement was low. Breathing-like "
        "motion was marked as detected because the breathing-like score "
        "stayed above the configured threshold while signal quality was {signal_quality}."
    ),
    "occupied_still_no_breathing_like": (
        "The prototype classified the bed as occupied and still, but "
        "breathing-like motion was not detected because the breathing-like "
        "score stayed below the configured threshold. A tester should review "
        "signal quality and sensor placement."
    ),
    "occupied_moving": (
        "The prototype classified the occupant as moving because the radar "
        "motion score crossed the movement threshold while occupancy stayed high."
    ),
    "possible_bed_exit": (
        "The prototype flagged a possible bed exit because pressure occupancy "
        "dropped sharply shortly after a radar motion spike. It is waiting for "
        "the confirmation window before classifying a full exit."
    ),
    "exited_bed": (
        "The prototype classified this as a bed exit because occupancy scores "
        "stayed below the empty threshold for the full confirmation window "
        "after a motion spike."
    ),
    "sensor_uncertain": (
        "The prototype could not settle on a state because the sensors "
        "disagree or signal quality is degraded. A tester should review the "
        "sensor streams for this period."
    ),
    "unknown": (
        "The prototype could not classify this period with confidence. Scores "
        "sat between the configured thresholds or data was incomplete."
    ),
}


def explain_state(state: dict) -> str:
    """Deterministic template explanation for a fused bed state."""
    template = STATE_TEMPLATES.get(state.get("overall_state", "unknown"), STATE_TEMPLATES["unknown"])
    text = template.format(signal_quality=state.get("signal_quality", "unknown"))
    src = state.get("source_summary") or {}
    contributing = []
    if src.get("pressure_occupancy") is not None:
        contributing.append(f"pressure occupancy {src['pressure_occupancy']}")
    if src.get("radar_occupancy") is not None:
        contributing.append(f"radar occupancy {src['radar_occupancy']}")
    if src.get("radar_motion") is not None:
        contributing.append(f"radar motion {src['radar_motion']}")
    if src.get("breathing_like_score") is not None:
        contributing.append(f"breathing-like score {src['breathing_like_score']}")
    if contributing:
        text += " Contributing signals: " + ", ".join(contributing) + "."
    return text


# --- Synthetic placeholder-vitals patterns (spec §21) ------------------------
# Deterministic, explanation-only. Values are simulated or manual placeholders.

def synthetic_pattern(vitals: dict, bed_state: dict | None = None) -> str | None:
    """Return a prototype concern-pattern label, or None.

    `vitals` holds latest placeholder values, e.g. {"respiratory_rate_placeholder":
    {"value": 22, "trend": "rising"}, ...}. This is a naming exercise for
    prototype testing only — not diagnosis, not a clinical score.
    """
    def val(metric: str) -> float | None:
        entry = vitals.get(metric)
        return entry.get("value") if isinstance(entry, dict) else entry

    def trend(metric: str) -> str | None:
        entry = vitals.get(metric)
        return entry.get("trend") if isinstance(entry, dict) else None

    state = (bed_state or {}).get("overall_state")
    movement = (bed_state or {}).get("movement_state")
    breathing = (bed_state or {}).get("breathing_like_detected")

    if (
        trend("respiratory_rate_placeholder") == "rising"
        and trend("spo2_placeholder") == "falling"
        and trend("heart_rate_placeholder") == "rising"
    ):
        return "prototype respiratory concern pattern"

    glucose = val("glucose_placeholder")
    if (
        (trend("glucose_placeholder") == "falling" or (glucose is not None and glucose < 4.0))
        and movement in ("still", "low_movement", "empty")
    ):
        return "prototype low-glucose concern pattern"

    if movement == "still" and breathing is False:
        return "prototype welfare-check pattern"

    if state in ("exited_bed", "possible_bed_exit") and vitals.get("fall_risk_flag"):
        return "prototype assist-needed pattern"

    return None
