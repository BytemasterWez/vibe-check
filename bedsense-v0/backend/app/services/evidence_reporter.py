"""Evidence pack generator (spec §17–18).

Writes a Markdown evidence report plus CSV exports. Operates on plain dicts
so it is testable without a database; the API layer converts ORM rows first.
"""
import csv
import json
from datetime import datetime, timezone
from pathlib import Path

from ..config import BOUNDARY_STATEMENT

CSV_EXPORTS = [
    "sensor_readings",
    "bed_states",
    "events",
    "experiment_summary",
    "risk_register",
]


def _stamp(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).strftime("%Y%m%d_%H%M%S")


def _fmt_ts(value) -> str:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S UTC")
    return str(value) if value else "—"


def generate_evidence_pack(
    evidence_dir: str | Path,
    session: dict,
    sensors: list[dict],
    readings: list[dict],
    bed_states: list[dict],
    events: list[dict],
    risks: list[dict],
    now: datetime | None = None,
) -> dict:
    """Write the Markdown report, JSON summary and CSV exports.

    Returns {"markdown_path": ..., "json_path": ..., "csv_paths": {...},
             "summary": {...}}.
    """
    evidence_dir = Path(evidence_dir)
    reports_dir = evidence_dir / "reports"
    exports_dir = evidence_dir / "exports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    exports_dir.mkdir(parents=True, exist_ok=True)

    stamp = _stamp(now)
    md_path = reports_dir / f"bedsense_v0_report_{stamp}.md"
    json_path = reports_dir / f"bedsense_v0_report_{stamp}.json"

    results = session.get("actual_results") or {}
    markdown = _build_markdown(session, sensors, readings, bed_states, events, risks, results)
    md_path.write_text(markdown)

    csv_paths = _write_csv_exports(exports_dir, stamp, session, readings, bed_states, events, risks)

    summary = {
        "session_name": session.get("name"),
        "scenario": session.get("scenario"),
        "pass_fail": session.get("pass_fail"),
        "readings_count": len(readings),
        "bed_states_count": len(bed_states),
        "events_count": len(events),
        "false_positive_count": results.get("false_positive_count"),
        "false_negative_count": results.get("false_negative_count"),
        "signal_quality_average": results.get("signal_quality_average"),
        "boundary_statement": BOUNDARY_STATEMENT,
    }
    json_path.write_text(json.dumps({"summary": summary, "results": results}, indent=2, default=str))

    return {
        "markdown_path": str(md_path),
        "json_path": str(json_path),
        "csv_paths": csv_paths,
        "summary": summary,
    }


def _build_markdown(session, sensors, readings, bed_states, events, risks, results) -> str:
    lines: list[str] = []
    add = lines.append

    add("# CableLight BedSense V0 Evidence Report")
    add("")
    add("## Prototype Boundary Statement")
    add("")
    add(f"> {BOUNDARY_STATEMENT}")
    add("")

    add("## Session Summary")
    add("")
    add(f"- **Session:** {session.get('name', '—')}")
    add(f"- **Session ID:** {session.get('id', '—')}")
    add(f"- **Scenario tested:** {session.get('scenario', '—')}")
    add(f"- **Operator:** {session.get('operator_name') or '—'}")
    add(f"- **Started:** {_fmt_ts(session.get('started_at'))}")
    add(f"- **Ended:** {_fmt_ts(session.get('ended_at'))}")
    add(f"- **Pass/fail:** {session.get('pass_fail', 'not_assessed')}")
    add(f"- **Notes:** {session.get('notes') or '—'}")
    add("")

    add("## Sensors Used")
    add("")
    if sensors:
        add("| Name | Type | Status | Location |")
        add("|------|------|--------|----------|")
        for s in sensors:
            add(f"| {s.get('name')} | {s.get('sensor_type')} | {s.get('status')} | {s.get('location') or '—'} |")
    else:
        add("_No sensors recorded for this session._")
    add("")

    add("## Expected Events")
    add("")
    expected = session.get("expected_events") or []
    if expected:
        for e in expected:
            add(f"- {e}")
    else:
        add("_None declared._")
    add("")

    add("## Actual Events")
    add("")
    add(f"Total events recorded: **{len(events)}**")
    add("")

    add("## Detection Results")
    add("")
    per_expected = results.get("expected") or []
    if per_expected:
        add("| Expected event | Detected | Delay (s) | Occurrences |")
        add("|----------------|----------|-----------|-------------|")
        for r in per_expected:
            detected = "yes" if r.get("detected") else "no"
            delay = r.get("detection_delay_seconds")
            add(f"| {r.get('expected_event')} | {detected} | {delay if delay is not None else '—'} | {r.get('occurrences', 0)} |")
    else:
        add("_No expected events assessed._")
    add("")

    add("## False Positives")
    add("")
    add(f"- Count: **{results.get('false_positive_count', 'not assessed')}**")
    fp_types = results.get("false_positive_types") or []
    if fp_types:
        add(f"- Types: {', '.join(fp_types)}")
    add("")

    add("## False Negatives")
    add("")
    add(f"- Count: **{results.get('false_negative_count', 'not assessed')}**")
    add("")

    add("## Signal Quality Summary")
    add("")
    avg_q = results.get("signal_quality_average")
    add(f"- Average quality score: **{avg_q if avg_q is not None else 'not assessed'}**")
    quality_counts: dict[str, int] = {}
    for bs in bed_states:
        q = bs.get("signal_quality") or "unknown"
        quality_counts[q] = quality_counts.get(q, 0) + 1
    if quality_counts:
        add("- Bed-state quality distribution: " + ", ".join(f"{k}: {v}" for k, v in sorted(quality_counts.items())))
    add("")

    add("## Event Timeline")
    add("")
    if events:
        add("| Time (UTC) | Event | Severity | Confidence | Description |")
        add("|-----------|-------|----------|------------|-------------|")
        for e in events:
            conf = e.get("confidence_score")
            add(
                f"| {_fmt_ts(e.get('timestamp_utc'))} | {e.get('event_type')} | "
                f"{e.get('severity')} | {conf if conf is not None else '—'} | "
                f"{(e.get('title') or '').replace('|', '/')} |"
            )
    else:
        add("_No events recorded._")
    add("")

    add("## Risk Register Summary")
    add("")
    if risks:
        add("| Risk | Category | Status |")
        add("|------|----------|--------|")
        for r in risks:
            add(f"| {r.get('risk_title')} | {r.get('risk_category')} | {r.get('status')} |")
    else:
        add("_Risk register is empty._")
    add("")

    add("## Screenshots")
    add("")
    add("_Placeholder — add dashboard screenshots from evidence/screenshots/ here._")
    add("")

    add("## Conclusion")
    add("")
    suggestion = results.get("all_expected_detected")
    if suggestion is True:
        add("All expected prototype events were detected in this session.")
    elif per_expected:
        add("Not all expected prototype events were detected; see detection results above.")
    else:
        add("This session was not assessed against expected events.")
    add("")
    add("This report documents prototype behaviour only and makes no clinical claims.")
    add("")

    add("## Next Validation Steps")
    add("")
    add("- Repeat the scenario and compare detection delays.")
    add("- Review any false positives/negatives against the raw sensor streams.")
    add("- Capture dashboard screenshots into evidence/screenshots/.")
    add("- Log any new risks in the risk register.")
    add("")

    return "\n".join(lines)


def _write_csv_exports(exports_dir: Path, stamp: str, session, readings, bed_states, events, risks) -> dict:
    session_id = str(session.get("id", ""))

    def write(name: str, fieldnames: list[str], rows: list[dict]) -> str:
        path = exports_dir / f"{name}_{stamp}.csv"
        with open(path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            for row in rows:
                out = {k: row.get(k) for k in fieldnames}
                for k, v in out.items():
                    if isinstance(v, datetime):
                        out[k] = v.isoformat()
                    elif isinstance(v, (dict, list)):
                        out[k] = json.dumps(v, default=str)
                writer.writerow(out)
        return str(path)

    for rows in (readings, bed_states, events):
        for row in rows:
            row.setdefault("session_id", session_id)

    results = session.get("actual_results") or {}
    summary_row = {
        "session_id": session_id,
        "name": session.get("name"),
        "scenario": session.get("scenario"),
        "operator_name": session.get("operator_name"),
        "started_at": session.get("started_at"),
        "ended_at": session.get("ended_at"),
        "pass_fail": session.get("pass_fail"),
        "false_positive_count": results.get("false_positive_count"),
        "false_negative_count": results.get("false_negative_count"),
        "signal_quality_average": results.get("signal_quality_average"),
        "notes": session.get("notes"),
    }
    risk_rows = [{**r, "session_id": session_id} for r in risks]

    return {
        "sensor_readings": write(
            "sensor_readings",
            ["session_id", "timestamp_utc", "sensor_type", "metric", "value_float",
             "value_text", "unit", "quality_score"],
            readings,
        ),
        "bed_states": write(
            "bed_states",
            ["session_id", "timestamp_utc", "occupied", "movement_state",
             "breathing_like_detected", "bed_exit_risk", "overall_state",
             "confidence_score", "signal_quality", "explanation"],
            bed_states,
        ),
        "events": write(
            "events",
            ["session_id", "timestamp_utc", "event_type", "severity",
             "confidence_score", "title", "description", "acknowledged"],
            events,
        ),
        "experiment_summary": write(
            "experiment_summary",
            list(summary_row.keys()),
            [summary_row],
        ),
        "risk_register": write(
            "risk_register",
            ["session_id", "risk_title", "risk_category", "description",
             "possible_cause", "impact", "mitigation", "status"],
            risk_rows,
        ),
    }
