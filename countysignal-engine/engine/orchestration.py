"""DB-facing orchestration for the post-ingestion pipeline stages:
features → events → experiments → scores. Pure logic lives in
engine.features / engine.events / engine.experiments / engine.scoring;
this module handles loading from and persisting to Postgres.

Scoring gate: only sources at COUNTY_JOIN_PASSING or above contribute
observations to feature matrices (and therefore to scores).
"""

from __future__ import annotations

import json

import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Connection

from engine.contracts import (
    EventContract,
    RecipeContract,
    SourceStatus,
    can_affect_scores,
)
from engine.events.engine import CaseControlSet, Occurrence
from engine.experiments.engine import ExperimentResult, ModelResult
from engine.scoring.engine import CountyScore


def scoring_eligible_sources(conn: Connection) -> set[str]:
    rows = conn.execute(text("SELECT source_id, status FROM registry.sources"))
    return {
        r.source_id for r in rows
        if can_affect_scores(SourceStatus[r.status])
    }


def load_observations(conn: Connection, *, scoring_only: bool = True) -> pd.DataFrame:
    """Long observation frame (county_fips, period, variable_id, value)."""
    sql = """SELECT county_fips, period_start AS period, variable_id,
                    value_numeric AS value, source_id
             FROM norm.county_observations"""
    df = pd.DataFrame([dict(r._mapping) for r in conn.execute(text(sql))])
    if df.empty:
        return df
    if scoring_only:
        eligible = scoring_eligible_sources(conn)
        df = df[df["source_id"].isin(eligible)]
    df["period"] = pd.to_datetime(df["period"])
    df["value"] = df["value"].astype(float)
    return df.drop(columns=["source_id"])


def county_attrs(conn: Connection) -> pd.DataFrame:
    return pd.DataFrame([dict(r._mapping) for r in conn.execute(
        text("SELECT county_fips, land_area FROM ref.counties WHERE is_active"))])


def county_names(conn: Connection) -> dict[str, str]:
    return {r.county_fips: f"{r.county_name}, {r.state_abbr}" for r in conn.execute(
        text("SELECT county_fips, county_name, state_abbr FROM ref.counties"))}


# --- features ---------------------------------------------------------------

def persist_feature_run(
    conn: Connection,
    feature_definitions: list[dict],
    matrix: pd.DataFrame,
    quality: pd.DataFrame,
    *,
    config: dict | None = None,
) -> int:
    run_id = conn.execute(text(
        "INSERT INTO feature.feature_runs (status, config) "
        "VALUES ('running', :cfg) RETURNING feature_run_id"),
        {"cfg": json.dumps(config or {}, default=str)}).fetchone()[0]

    for fd in feature_definitions:
        conn.execute(text(
            """INSERT INTO feature.feature_definitions (feature_id, variable_id, transform, params)
               VALUES (:feature_id, :variable_id, :transform, :params)
               ON CONFLICT (feature_id) DO NOTHING"""),
            {"feature_id": fd["feature_id"], "variable_id": fd["variable_id"],
             "transform": fd["transform"],
             "params": json.dumps(fd.get("params") or {}, default=str)})

    rows = [
        {"run": run_id, "fips": r.county_fips, "period": r.period.date(),
         "fid": r.feature_id,
         "val": None if pd.isna(r.feature_value) else float(r.feature_value)}
        for r in matrix.itertuples(index=False)
    ]
    for chunk_start in range(0, len(rows), 5000):
        conn.execute(text(
            """INSERT INTO feature.feature_matrix
               (feature_run_id, county_fips, period, feature_id, feature_value)
               VALUES (:run, :fips, :period, :fid, :val)
               ON CONFLICT (feature_run_id, county_fips, period, feature_id) DO NOTHING"""),
            rows[chunk_start:chunk_start + 5000])

    for q in quality.itertuples(index=False):
        conn.execute(text(
            """INSERT INTO feature.feature_quality
               (feature_run_id, feature_id, period, coverage, null_rate, mean, stddev, p01, p99)
               VALUES (:run, :fid, :period, :cov, :nr, :mean, :std, :p01, :p99)
               ON CONFLICT (feature_run_id, feature_id, period) DO NOTHING"""),
            {"run": run_id, "fid": q.feature_id, "period": q.period.date(),
             "cov": q.coverage, "nr": q.null_rate,
             "mean": _f(q.mean), "std": _f(q.stddev), "p01": _f(q.p01), "p99": _f(q.p99)})

    conn.execute(text(
        "UPDATE feature.feature_runs SET status='succeeded', finished_at=now(), "
        "row_count=:n WHERE feature_run_id=:run"), {"n": len(rows), "run": run_id})
    return run_id


def load_feature_matrix(conn: Connection, feature_run_id: int) -> pd.DataFrame:
    df = pd.DataFrame([dict(r._mapping) for r in conn.execute(text(
        """SELECT county_fips, period, feature_id, feature_value
           FROM feature.feature_matrix WHERE feature_run_id = :run"""),
        {"run": feature_run_id})])
    if not df.empty:
        df["period"] = pd.to_datetime(df["period"])
        df["feature_value"] = df["feature_value"].astype(float)
    return df


def latest_feature_run_id(conn: Connection) -> int:
    row = conn.execute(text(
        "SELECT feature_run_id FROM feature.feature_runs "
        "WHERE status='succeeded' ORDER BY feature_run_id DESC LIMIT 1")).fetchone()
    if not row:
        raise RuntimeError("no successful feature run found — run scripts.run_features first")
    return int(row[0])


# --- events -------------------------------------------------------------------

def persist_event(
    conn: Connection,
    event: EventContract,
    occurrences: list[Occurrence],
    case_control: CaseControlSet,
    feature_run_id: int,
) -> int:
    conn.execute(text(
        """INSERT INTO event.definitions (event_id, description, base_variable,
               feature_id, operator, threshold, time_grain, minimum_history_months,
               config_yaml, config_hash)
           VALUES (:eid, :desc, :bv, :fid, :op, :thr, :tg, :mhm, :yaml, :hash)
           ON CONFLICT (event_id) DO UPDATE SET
               description=EXCLUDED.description, config_yaml=EXCLUDED.config_yaml,
               config_hash=EXCLUDED.config_hash, operator=EXCLUDED.operator,
               threshold=EXCLUDED.threshold"""),
        {"eid": event.event_id, "desc": event.description, "bv": event.base_variable,
         "fid": f"{event.base_variable}__{event.condition.transform}",
         "op": event.condition.operator, "thr": event.condition.threshold,
         "tg": event.time_grain, "mhm": event.minimum_history_months,
         "yaml": event.raw_yaml, "hash": event.config_hash})

    for o in occurrences:
        conn.execute(text(
            """INSERT INTO event.occurrences (event_id, county_fips, period,
                   trigger_value, feature_run_id)
               VALUES (:eid, :fips, :period, :tv, :run)
               ON CONFLICT (event_id, county_fips, period) DO UPDATE SET
                   trigger_value = EXCLUDED.trigger_value,
                   feature_run_id = EXCLUDED.feature_run_id"""),
            {"eid": o.event_id, "fips": o.county_fips, "period": o.period.date(),
             "tv": o.trigger_value, "run": feature_run_id})

    members = (
        [{"role": "case", **c} for c in case_control.cases]
        + [{"role": "control", **c} for c in case_control.controls]
        + [{"role": "excluded", **e} for e in case_control.excluded]
    )
    set_id = conn.execute(text(
        """INSERT INTO event.case_control_sets (event_id, feature_run_id, case_count,
               control_count, excluded_count, matching_config, members)
           VALUES (:eid, :run, :cc, :ctc, :exc, :cfg, :members)
           RETURNING set_id"""),
        {"eid": event.event_id, "run": feature_run_id,
         "cc": len(case_control.cases), "ctc": len(case_control.controls),
         "exc": len(case_control.excluded),
         "cfg": json.dumps(event.case_control.model_dump(), default=str),
         "members": json.dumps(members, default=str)}).fetchone()[0]
    return int(set_id)


# --- experiments -----------------------------------------------------------------

def persist_experiment(
    conn: Connection,
    result: ExperimentResult,
    feature_run_id: int,
    case_control_set_id: int | None = None,
) -> tuple[int, int]:
    """Returns (experiment_id, model_id of best non-baseline model)."""
    experiment_id = conn.execute(text(
        """INSERT INTO experiment.runs (event_id, feature_run_id, case_control_set_id,
               status, case_count, control_count, train_period, test_period,
               finished_at, diagnostics_json)
           VALUES (:eid, :run, :ccs, 'succeeded', :cc, :ctc, :tr, :te, now(), :diag)
           RETURNING experiment_id"""),
        {"eid": result.event_id, "run": feature_run_id, "ccs": case_control_set_id,
         "cc": result.case_count, "ctc": result.control_count,
         "tr": result.train_period, "te": result.test_period,
         "diag": json.dumps(result.diagnostics, default=str)}).fetchone()[0]

    best_model_id = None
    best = result.best_model
    for m in result.models:
        model_id = conn.execute(text(
            """INSERT INTO experiment.models (experiment_id, model_type, is_baseline)
               VALUES (:eid, :mt, :bl) RETURNING model_id"""),
            {"eid": experiment_id, "mt": m.model_type, "bl": m.is_baseline}).fetchone()[0]
        if m is best:
            best_model_id = model_id
        for metric, value in m.metrics.items():
            if value != value:  # NaN guard
                continue
            name, k = metric, 0
            if "_at_" in metric:
                name, _, k_str = metric.rpartition("_at_")
                k = int(k_str)
            conn.execute(text(
                """INSERT INTO experiment.metrics (model_id, metric, k, split, value)
                   VALUES (:mid, :metric, :k, 'test', :value)
                   ON CONFLICT DO NOTHING"""),
                {"mid": model_id, "metric": name, "k": k, "value": float(value)})
        for r in m.rankings:
            conn.execute(text(
                """INSERT INTO experiment.variable_rankings
                   (experiment_id, model_id, feature_id, rank, importance, direction)
                   VALUES (:eid, :mid, :fid, :rank, :imp, :dir)
                   ON CONFLICT (model_id, feature_id) DO NOTHING"""),
                {"eid": experiment_id, "mid": model_id, "fid": r["feature_id"],
                 "rank": r["rank"], "imp": r["importance"], "dir": r["direction"]})

    for check, passed in (
        ("trigger_feature_excluded", bool(result.diagnostics.get("trigger_feature_excluded"))),
        ("features_precede_label", bool(result.diagnostics.get("features_precede_label"))),
        ("baseline_compared", any(m.is_baseline for m in result.models)),
    ):
        conn.execute(text(
            """INSERT INTO experiment.case_control_diagnostics
               (experiment_id, check_name, passed, detail)
               VALUES (:eid, :check, :passed, '{}')
               ON CONFLICT (experiment_id, check_name) DO NOTHING"""),
            {"eid": experiment_id, "check": check, "passed": passed})

    return int(experiment_id), int(best_model_id)


# --- scores ------------------------------------------------------------------------

def persist_scores(
    conn: Connection,
    recipe: RecipeContract,
    experiment_id: int,
    model_id: int,
    model_result: ModelResult,
    scores: list[CountyScore],
) -> int:
    model_version = f"exp{experiment_id}-{model_result.model_type}"
    score_version_id = conn.execute(text(
        """INSERT INTO score.score_versions (recipe_id, event_id, experiment_id,
               model_id, model_version, recipe_config)
           VALUES (:rid, :eid, :xid, :mid, :mv, :cfg)
           RETURNING score_version_id"""),
        {"rid": recipe.recipe_id, "eid": recipe.event_id, "xid": experiment_id,
         "mid": model_id, "mv": model_version,
         "cfg": json.dumps(recipe.model_dump(), default=str)}).fetchone()[0]

    for s in scores:
        conn.execute(text(
            """INSERT INTO score.county_scores (score_version_id, recipe_id, event_id,
                   county_fips, period, score, rank_national, rank_state, confidence,
                   top_positive_factors, top_negative_factors, evidence_json, model_version)
               VALUES (:svid, :rid, :eid, :fips, :period, :score, :rn, :rs, :conf,
                       :tp, :tn, :ev, :mv)
               ON CONFLICT (score_version_id, county_fips, period) DO NOTHING"""),
            {"svid": score_version_id, "rid": recipe.recipe_id, "eid": recipe.event_id,
             "fips": s.county_fips, "period": s.period, "score": s.score,
             "rn": s.rank_national, "rs": s.rank_state, "conf": s.confidence,
             "tp": json.dumps(s.top_positive_factors), "tn": json.dumps(s.top_negative_factors),
             "ev": json.dumps(s.evidence, default=str), "mv": model_version})
        conn.execute(text(
            """INSERT INTO score.county_rankings (score_version_id, recipe_id, period,
                   county_fips, rank_national, rank_state, score)
               VALUES (:svid, :rid, :period, :fips, :rn, :rs, :score)
               ON CONFLICT (score_version_id, period, county_fips) DO NOTHING"""),
            {"svid": score_version_id, "rid": recipe.recipe_id, "period": s.period,
             "fips": s.county_fips, "rn": s.rank_national, "rs": s.rank_state,
             "score": s.score})
    return int(score_version_id)


def _f(v):
    return None if v is None or v != v else float(v)
