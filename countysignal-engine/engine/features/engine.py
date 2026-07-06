"""Feature engine: expands feature definitions (config) over normalised
observations into a long feature matrix.

Inputs  (long): county_fips, period, variable_id, value
Outputs (long): county_fips, period, feature_id, feature_value
"""

from __future__ import annotations

import pandas as pd

from engine.features.transforms import (
    apply_transform,
    is_known_transform,
    transform_needs_denominator,
)


def build_feature_matrix(
    observations: pd.DataFrame,
    feature_definitions: list[dict],
    *,
    county_attrs: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Compute every defined feature.

    observations: long frame with county_fips, period, variable_id, value.
    feature_definitions: [{feature_id, variable_id, transform, params}].
    """
    if observations.empty:
        return pd.DataFrame(columns=["county_fips", "period", "feature_id", "feature_value"])

    obs = observations.copy()
    obs["period"] = pd.to_datetime(obs["period"])
    frames: list[pd.DataFrame] = []

    for fd in feature_definitions:
        transform = fd["transform"]
        if not is_known_transform(transform):
            raise ValueError(f"feature {fd['feature_id']}: unknown transform {transform}")

        var_obs = obs[obs["variable_id"] == fd["variable_id"]][
            ["county_fips", "period", "value"]
        ]
        if var_obs.empty:
            continue
        var_obs = var_obs.sort_values(["county_fips", "period"]).reset_index(drop=True)

        denominator = None
        if transform_needs_denominator(transform):
            den_var = (fd.get("params") or {}).get("per_capita_denominator")
            if den_var:
                denominator = obs[obs["variable_id"] == den_var][
                    ["county_fips", "period", "value"]
                ]

        values = apply_transform(
            var_obs, transform, denominator=denominator, county_attrs=county_attrs
        )
        out = var_obs[["county_fips", "period"]].copy()
        out["feature_id"] = fd["feature_id"]
        out["feature_value"] = values.values
        frames.append(out)

    if not frames:
        return pd.DataFrame(columns=["county_fips", "period", "feature_id", "feature_value"])
    return pd.concat(frames, ignore_index=True)


def matrix_as_of(
    feature_matrix: pd.DataFrame,
    period: pd.Timestamp,
    *,
    max_staleness_months: int = 36,
) -> pd.DataFrame:
    """Wide feature frame as observed at `period` (one row per county).

    For each (county, feature) the latest value at or before `period` is
    used, so slow-moving (annual/static) features stay available at monthly
    grain without ever looking into the future. Values older than
    max_staleness_months are dropped.
    """
    fm = feature_matrix.copy()
    fm["period"] = pd.to_datetime(fm["period"])
    cutoff = period - pd.DateOffset(months=max_staleness_months)
    fm = fm[(fm["period"] <= period) & (fm["period"] >= cutoff)]
    fm = fm.sort_values("period").groupby(["county_fips", "feature_id"], as_index=False).last()
    wide = fm.pivot(index="county_fips", columns="feature_id", values="feature_value")
    wide.columns.name = None
    return wide.reset_index()


def feature_quality(feature_matrix: pd.DataFrame, active_county_count: int) -> pd.DataFrame:
    """Per-feature/period quality stats for feature.feature_quality."""
    rows = []
    for (feature_id, period), grp in feature_matrix.groupby(["feature_id", "period"]):
        vals = grp["feature_value"]
        rows.append(
            {
                "feature_id": feature_id,
                "period": period,
                "coverage": len(grp) / active_county_count if active_county_count else 0.0,
                "null_rate": float(vals.isna().mean()),
                "mean": float(vals.mean()) if vals.notna().any() else None,
                "stddev": float(vals.std()) if vals.notna().sum() > 1 else None,
                "p01": float(vals.quantile(0.01)) if vals.notna().any() else None,
                "p99": float(vals.quantile(0.99)) if vals.notna().any() else None,
            }
        )
    return pd.DataFrame(rows)
