import numpy as np
import pandas as pd
import pytest

from engine.features.engine import build_feature_matrix, matrix_as_of
from engine.features.transforms import apply_transform, is_known_transform


def series(values_by_county: dict[str, list[float]], start="2024-01-01") -> pd.DataFrame:
    rows = []
    for fips, values in values_by_county.items():
        periods = pd.date_range(start, periods=len(values), freq="MS")
        for p, v in zip(periods, values):
            rows.append({"county_fips": fips, "period": p, "value": v})
    return pd.DataFrame(rows)


def test_change_12m_uses_exact_offset():
    df = series({"22103": list(range(1, 15))})   # 1..14 over 14 months
    out = apply_transform(df, "change_12m")
    assert np.isnan(out.iloc[0])                 # no data 12m before
    assert out.iloc[12] == 12.0                  # 13 - 1
    assert out.iloc[13] == 12.0


def test_change_12m_gap_does_not_misalign():
    # A county missing month 2 must not silently take an 11-month diff.
    df = series({"22103": list(range(1, 15))})
    df = df[df["period"] != pd.Timestamp("2024-02-01")].reset_index(drop=True)
    out = apply_transform(df, "change_12m")
    feb_2025 = df.index[df["period"] == pd.Timestamp("2025-02-01")][0]
    assert np.isnan(out.iloc[feb_2025]), "lag against a missing month must be NaN"


def test_pct_change_and_rolling():
    df = series({"x0001": [100.0] * 12 + [110.0]})
    pct = apply_transform(df, "pct_change_12m")
    assert pct.iloc[12] == pytest.approx(10.0)
    roll = apply_transform(df, "rolling_avg_3m")
    assert np.isnan(roll.iloc[1])                # window not full yet
    assert roll.iloc[2] == pytest.approx(100.0)
    assert roll.iloc[12] == pytest.approx((100 + 100 + 110) / 3)


def test_zscore_and_ranks_are_cross_sectional():
    df = series({"01001": [1.0], "02001": [2.0], "03001": [3.0], "03003": [6.0]},
                start="2025-01-01")
    z = apply_transform(df, "zscore_national")
    assert z.mean() == pytest.approx(0.0)
    rank = apply_transform(df, "rank_national")
    df2 = df.sort_values(["county_fips", "period"]).reset_index(drop=True)
    assert rank[df2["county_fips"] == "03003"].iloc[0] == 1  # highest value = rank 1
    state_rank = apply_transform(df, "rank_state")
    assert state_rank[df2["county_fips"] == "03001"].iloc[0] == 2
    assert state_rank[df2["county_fips"] == "01001"].iloc[0] == 1


def test_per_capita_uses_latest_backward_denominator():
    numer = series({"22103": [10.0, 20.0]}, start="2025-06-01")
    denom = pd.DataFrame([
        {"county_fips": "22103", "period": pd.Timestamp("2025-01-01"), "value": 100.0},
        # future denominator must NOT be used for 2025-06/07
        {"county_fips": "22103", "period": pd.Timestamp("2026-01-01"), "value": 1e9},
    ])
    out = apply_transform(numer, "per_capita", denominator=denom)
    assert out.iloc[0] == pytest.approx(0.1)
    assert out.iloc[1] == pytest.approx(0.2)


def test_missing_indicator():
    df = series({"22103": [1.0, np.nan, 3.0]})
    out = apply_transform(df, "missing_indicator")
    assert list(out) == [0.0, 1.0, 0.0]


def test_unknown_transform_rejected():
    assert not is_known_transform("hallucinate_5x")
    with pytest.raises(ValueError):
        apply_transform(series({"22103": [1.0]}), "hallucinate_5x")


def test_build_feature_matrix_long_output():
    obs = series({"22103": [4.0, 5.0], "48201": [3.0, 3.5]})
    obs["variable_id"] = "bls_laus_unemployment_rate"
    obs = obs.rename(columns={"value": "value"})
    defs = [
        {"feature_id": "bls_laus_unemployment_rate__latest_value",
         "variable_id": "bls_laus_unemployment_rate", "transform": "latest_value", "params": {}},
        {"feature_id": "bls_laus_unemployment_rate__change_1m",
         "variable_id": "bls_laus_unemployment_rate", "transform": "change_1m", "params": {}},
    ]
    fm = build_feature_matrix(obs, defs)
    assert set(fm["feature_id"]) == {d["feature_id"] for d in defs}
    assert len(fm) == 8   # 2 counties x 2 periods x 2 features


def test_matrix_as_of_never_looks_forward():
    fm = pd.DataFrame([
        {"county_fips": "22103", "period": pd.Timestamp("2025-01-01"),
         "feature_id": "f", "feature_value": 1.0},
        {"county_fips": "22103", "period": pd.Timestamp("2025-03-01"),
         "feature_id": "f", "feature_value": 99.0},
    ])
    wide = matrix_as_of(fm, pd.Timestamp("2025-02-01"))
    assert wide.loc[wide["county_fips"] == "22103", "f"].iloc[0] == 1.0
    # staleness cutoff drops ancient values
    wide2 = matrix_as_of(fm, pd.Timestamp("2028-01-01"), max_staleness_months=12)
    assert wide2.empty
