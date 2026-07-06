"""Feature transforms over county-time series.

Every transform is computed per (county, period) using only data at or
before that period — never future data. Cross-sectional transforms
(z-scores, ranks) use other counties at the *same* period only.

Input frame (long): county_fips, period (datetime64), value (float).
Output: same index with one value per (county_fips, period).
"""

from __future__ import annotations

import re

import numpy as np
import pandas as pd

_CHANGE_RE = re.compile(r"^change_(\d+)m$")
_PCT_CHANGE_RE = re.compile(r"^pct_change_(\d+)m$")
_ROLLING_RE = re.compile(r"^rolling_avg_(\d+)m$")

KNOWN_STATIC_TRANSFORMS = {
    "latest_value",
    "zscore_national",
    "zscore_state",
    "rank_national",
    "rank_state",
    "per_capita",
    "per_establishment",
    "per_square_mile",
    "missing_indicator",
}


def _sorted(df: pd.DataFrame) -> pd.DataFrame:
    return df.sort_values(["county_fips", "period"]).reset_index(drop=True)


def _lag_join(df: pd.DataFrame, months: int) -> pd.Series:
    """Value at exactly `months` before each row's period (NaN if absent).

    Uses an exact period-offset join rather than positional shift so gaps in
    a county's series can't silently misalign lags.
    """
    lagged = df[["county_fips", "period", "value"]].copy()
    lagged["period"] = lagged["period"] + pd.DateOffset(months=months)
    merged = df.merge(
        lagged, on=["county_fips", "period"], how="left", suffixes=("", "_lag")
    )
    return merged["value_lag"]


def apply_transform(
    df: pd.DataFrame,
    transform: str,
    *,
    denominator: pd.DataFrame | None = None,
    county_attrs: pd.DataFrame | None = None,
) -> pd.Series:
    """Apply one named transform; returns a Series aligned to _sorted(df).

    denominator: long frame (county_fips, period, value) for per_capita /
        per_establishment; the latest denominator at or before each period
        is used (merge_asof backward — no future data).
    county_attrs: frame (county_fips, land_area) for per_square_mile.
    """
    df = _sorted(df)

    if transform == "latest_value":
        return df["value"]

    if transform == "missing_indicator":
        return df["value"].isna().astype(float)

    m = _CHANGE_RE.match(transform)
    if m:
        return df["value"] - _lag_join(df, int(m.group(1)))

    m = _PCT_CHANGE_RE.match(transform)
    if m:
        prev = _lag_join(df, int(m.group(1)))
        prev = prev.where(prev != 0, np.nan)
        return (df["value"] - prev) / prev.abs() * 100.0

    m = _ROLLING_RE.match(transform)
    if m:
        window = int(m.group(1))
        return (
            df.groupby("county_fips", group_keys=False)["value"]
            .apply(lambda s: s.rolling(window=window, min_periods=window).mean())
            .reset_index(drop=True)
        )

    if transform == "zscore_national":
        grp = df.groupby("period")["value"]
        mean, std = grp.transform("mean"), grp.transform("std")
        return (df["value"] - mean) / std.where(std > 0, np.nan)

    if transform == "zscore_state":
        state = df["county_fips"].str[:2]
        grp = df.groupby([df["period"], state])["value"]
        mean, std = grp.transform("mean"), grp.transform("std")
        return (df["value"] - mean) / std.where(std > 0, np.nan)

    if transform == "rank_national":
        # rank 1 = highest value at that period
        return df.groupby("period")["value"].rank(ascending=False, method="min")

    if transform == "rank_state":
        state = df["county_fips"].str[:2]
        return df.groupby([df["period"], state])["value"].rank(ascending=False, method="min")

    if transform in ("per_capita", "per_establishment"):
        if denominator is None or denominator.empty:
            raise ValueError(f"{transform} requires a denominator series")
        den = _sorted(denominator).rename(columns={"value": "den"})
        merged = pd.merge_asof(
            df.sort_values("period"),
            den.sort_values("period"),
            on="period",
            by="county_fips",
            direction="backward",
        ).sort_values(["county_fips", "period"]).reset_index(drop=True)
        den_vals = merged["den"].where(merged["den"] > 0, np.nan)
        return merged["value"] / den_vals

    if transform == "per_square_mile":
        if county_attrs is None:
            raise ValueError("per_square_mile requires county_attrs with land_area (sq m)")
        attrs = county_attrs.set_index("county_fips")["land_area"]
        sq_miles = df["county_fips"].map(attrs) / 2_589_988.11  # sq m per sq mile
        return df["value"] / sq_miles.where(sq_miles > 0, np.nan)

    raise ValueError(f"unknown transform: {transform}")


def transform_needs_denominator(transform: str) -> bool:
    return transform in ("per_capita", "per_establishment")


def is_known_transform(transform: str) -> bool:
    return (
        transform in KNOWN_STATIC_TRANSFORMS
        or bool(_CHANGE_RE.match(transform))
        or bool(_PCT_CHANGE_RE.match(transform))
        or bool(_ROLLING_RE.match(transform))
    )
