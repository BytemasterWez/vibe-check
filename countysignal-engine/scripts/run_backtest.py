"""Historical event backtest with an explicit train/test window split.

    python -m scripts.run_backtest --event unemployment_spike_2pp_12m \
        --train-start 2010-01-01 --split 2019-01-01 --test-end 2024-12-31

Produces, under exports/backtests/<event>_<stamp>/:
    report.json      — case/control counts, windows, metrics vs baselines,
                       top variables, false positives/negatives
    report.md        — the same, human-readable
    scorecard.csv    — ranked test-window predictions per county
    methodology.md   — sources, coverage, event definition, matching,
                       features, models, baselines, limitations, provenance

The harness reuses the engine unchanged: detection, case/control matching,
experiment training and metrics all come from engine.events / engine.experiments.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

import pandas as pd
from sqlalchemy import text

from engine.config import EXPORTS_DIR
from engine.contracts import load_event_contracts
from engine.db import get_engine
from engine.events.engine import build_case_control_set, detect_occurrences
from engine.experiments.engine import assemble_design_matrix, run_experiment
from engine.exports.csv_export import rows_to_csv
from engine.orchestration import (
    county_names,
    latest_feature_run_id,
    load_feature_matrix,
    load_observations,
    persist_experiment,
)
from engine.validation import validate_experiment


def test_window_predictions(result, case_control, feature_matrix, split_at,
                            horizon_months):
    """Per-county predictions for the test window from the best model."""
    best = result.best_model
    design = assemble_design_matrix(
        case_control, feature_matrix,
        prediction_horizon_months=horizon_months,
        exclude_features=set(),  # keep all columns; reindex below uses model features
    )
    test = design[design["label_period"] >= split_at].reset_index(drop=True)
    if test.empty:
        return pd.DataFrame()
    means = pd.Series(best.train_means).reindex(best.feature_ids).fillna(0.0)
    stds = pd.Series(best.train_stds).reindex(best.feature_ids).replace(0, 1.0).fillna(1.0)
    X = ((test.reindex(columns=best.feature_ids) - means) / stds).fillna(0.0).to_numpy()
    test["predicted_probability"] = best.model.predict_proba(X)[:, 1]
    out = test[["county_fips", "label_period", "y", "predicted_probability"]].copy()
    out = out.sort_values("predicted_probability", ascending=False).reset_index(drop=True)
    out["rank"] = out.index + 1
    return out


def false_pos_neg(preds: pd.DataFrame, n: int = 10) -> tuple[list[dict], list[dict]]:
    fps = preds[(preds["y"] == 0)].nlargest(n, "predicted_probability")
    fns = preds[(preds["y"] == 1)].nsmallest(n, "predicted_probability")
    fmt = lambda df: [
        {"county_fips": r.county_fips, "label_period": str(pd.Timestamp(r.label_period).date()),
         "predicted_probability": round(float(r.predicted_probability), 4),
         "rank": int(r.rank)}
        for r in df.itertuples(index=False)
    ]
    return fmt(fps), fmt(fns)


def write_methodology(path: Path, *, conn, event, result, case_control,
                      windows: dict, feature_count: int, county_count: int) -> None:
    sources = [dict(r._mapping) for r in conn.execute(text(
        """SELECT s.source_id, s.name, s.owner, s.licence_status, s.status,
                  h.latest_period, h.county_join_rate, h.freshness_days
           FROM registry.sources s
           LEFT JOIN registry.source_health h USING (source_id)
           ORDER BY s.source_id"""))]
    diag = case_control.diagnostics()
    best = result.best_model
    lines = [
        f"# Methodology note — {event.event_id} backtest",
        f"\nGenerated {datetime.utcnow().isoformat(timespec='seconds')}Z by the "
        "CountySignal Engine backtest harness. Every number below is "
        "reproducible from the source contracts, raw artifact hashes and "
        "ingestion runs recorded in the registry.",
        "\n## Sources used",
    ]
    for s in sources:
        lines.append(
            f"- **{s['source_id']}** — {s['name']} ({s['owner']}); licence "
            f"{s['licence_status']}; lifecycle {s['status']}; latest period "
            f"{s['latest_period']}; county join rate {s['county_join_rate']}")
    lines += [
        "\n## County coverage",
        f"{county_count} active county-equivalents in ref.counties participated. "
        "Sources below COUNTY_JOIN_PASSING are excluded from features and "
        "therefore from this backtest.",
        "\n## Event definition",
        f"```yaml\n{event.raw_yaml.strip()}\n```",
        "\n## Case/control matching",
        f"- cases: first qualifying occurrence per county ({diag['case_count']})",
        f"- controls: non-event counties sampled at case periods ({diag['control_count']})",
        f"- excluded: {diag['excluded_count']} (missing condition feature or not sampled)",
        f"- control/case ratio: {diag['control_case_ratio']:.1f}"
        if diag["control_case_ratio"] else "- control/case ratio: n/a",
        "\n## Windows",
        f"- training label periods: {windows['train']}",
        f"- test label periods: {windows['test']}",
        f"- prediction horizon: features observed {windows['horizon_months']} months "
        "before each label period (no future data; the event's own trigger "
        "feature is excluded from the design matrix)",
        "\n## Features tested",
        f"{feature_count} features from contracts/features/default_features.yaml "
        "(lags, changes, rolling means, national/state z-scores and ranks, "
        "per-capita transforms).",
        "\n## Models and baselines",
    ]
    for m in result.models:
        tag = "baseline" if m.is_baseline else "model"
        lines.append(f"- {tag}: {m.model_type} — " + ", ".join(
            f"{k}={v:.4f}" for k, v in sorted(m.metrics.items()) if v == v))
    lines += [
        f"\nBest model: **{best.model_type}**.",
        "\n## Limitations",
        "- Case counts depend on event threshold choice; rarity limits statistical power.",
        "- Controls are sampled, not exhaustively matched on covariates.",
        "- Annual/static variables enter monthly matrices as-of their vintage "
        "with a staleness cutoff; reporting lags apply.",
        "- Scores are similarity-to-historical-conditions estimates, not causal claims.",
        "\n## Provenance and freshness",
        "Every observation used carries provenance to a hashed raw artifact "
        "(see /v1/provenance/{record_id}). Source freshness at run time is "
        "listed in the sources table above.",
    ]
    path.write_text("\n".join(lines) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--event", required=True)
    parser.add_argument("--train-start", required=True, help="YYYY-MM-DD")
    parser.add_argument("--split", required=True,
                        help="YYYY-MM-DD boundary: labels before train, at/after test")
    parser.add_argument("--test-end", required=True, help="YYYY-MM-DD")
    parser.add_argument("--horizon", type=int, default=6)
    parser.add_argument("--k", type=int, nargs="+", default=[50, 100])
    parser.add_argument("--feature-run", type=int, default=None)
    parser.add_argument("--out-dir", type=Path, default=None)
    args = parser.parse_args()

    train_start = pd.Timestamp(args.train_start)
    split_at = pd.Timestamp(args.split)
    test_end = pd.Timestamp(args.test_end)
    event = load_event_contracts()[args.event]

    with get_engine().begin() as conn:
        run_id = args.feature_run or latest_feature_run_id(conn)
        matrix = load_feature_matrix(conn, run_id)
        matrix = matrix[(matrix["period"] >= train_start) & (matrix["period"] <= test_end)]
        observations = load_observations(conn, scoring_only=True)

        occurrences = detect_occurrences(event, matrix, observations)
        case_control = build_case_control_set(event, occurrences, matrix)
        result = run_experiment(
            event, case_control, matrix,
            prediction_horizon_months=args.horizon,
            split_at=split_at, ks=tuple(args.k),
        )
        report_val = validate_experiment(result)
        experiment_id, _ = persist_experiment(conn, result, run_id)
        names = county_names(conn)
        county_count = int(conn.execute(text(
            "SELECT count(*) FROM ref.counties WHERE is_active")).fetchone()[0])

        preds = test_window_predictions(result, case_control, matrix, split_at,
                                        args.horizon)
        fps, fns = false_pos_neg(preds)
        for lst in (fps, fns):
            for item in lst:
                item["county_name"] = names.get(item["county_fips"], "")

        stamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        out_dir = args.out_dir or (EXPORTS_DIR / "backtests" / f"{event.event_id}_{stamp}")
        out_dir.mkdir(parents=True, exist_ok=True)

        best = result.best_model
        report = {
            "experiment_id": experiment_id,
            "event_id": event.event_id,
            "windows": {"train_start": str(train_start.date()),
                        "split": str(split_at.date()),
                        "test_end": str(test_end.date()),
                        "train_label_periods": result.train_period,
                        "test_label_periods": result.test_period,
                        "horizon_months": args.horizon},
            "case_count": result.case_count,
            "control_count": result.control_count,
            "best_model": best.model_type,
            "metrics": best.metrics,
            "baselines": {m.model_type: m.metrics for m in result.models if m.is_baseline},
            "top_variables": result.top_variables,
            "false_positives": fps,
            "false_negatives": fns,
            "diagnostics": result.diagnostics,
            "validation_passed": report_val.passed,
        }
        (out_dir / "report.json").write_text(json.dumps(report, indent=2, default=str))

        scorecard_rows = [
            {"rank": int(r.rank), "county_fips": r.county_fips,
             "county_name": names.get(r.county_fips, ""),
             "label_period": str(pd.Timestamp(r.label_period).date()),
             "predicted_probability": round(float(r.predicted_probability), 6),
             "actual_event": int(r.y)}
            for r in preds.itertuples(index=False)
        ]
        rows_to_csv(scorecard_rows, out_dir / "scorecard.csv")

        write_methodology(
            out_dir / "methodology.md", conn=conn, event=event, result=result,
            case_control=case_control,
            windows={"train": result.train_period, "test": result.test_period,
                     "horizon_months": args.horizon},
            feature_count=result.diagnostics.get("n_features", 0),
            county_count=county_count,
        )

        md = [
            f"# Backtest report — {event.event_id}",
            f"- experiment_id: {experiment_id}",
            f"- windows: train {result.train_period} | test {result.test_period} "
            f"(horizon {args.horizon}m)",
            f"- cases: {result.case_count}  controls: {result.control_count}",
            f"- best model: {best.model_type}",
            "\n## Metrics (test window)",
            *(f"- {k}: {v:.4f}" for k, v in sorted(best.metrics.items()) if v == v),
            "\n## Baselines",
            *(f"- {m.model_type}: auc={m.metrics.get('auc', float('nan')):.4f}"
              for m in result.models if m.is_baseline),
            "\n## Top variables",
            *(f"{r['rank']}. {r['feature_id']} ({r['direction']}, {r['importance']:.4f})"
              for r in result.top_variables[:15]),
            "\n## Top false positives (test window)",
            *(f"- {f['county_name'] or f['county_fips']} @ {f['label_period']} "
              f"p={f['predicted_probability']}" for f in fps),
            "\n## Top false negatives (test window)",
            *(f"- {f['county_name'] or f['county_fips']} @ {f['label_period']} "
              f"p={f['predicted_probability']}" for f in fns),
        ]
        (out_dir / "report.md").write_text("\n".join(md) + "\n")

    print(json.dumps({"out_dir": str(out_dir), "experiment_id": experiment_id,
                      "cases": result.case_count, "controls": result.control_count,
                      "auc": best.metrics.get("auc"),
                      **{k: v for k, v in best.metrics.items() if k.startswith("precision")},
                      "validation_passed": report_val.passed}, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
