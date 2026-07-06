"""Generate deterministic sample fixtures for the three Milestone 1 sources.

These are SYNTHETIC datasets shaped exactly like the real upstream formats,
used for offline sample runs and tests (network-free). Real ingestion always
fetches from the official sources. The generator plants a known pattern —
ten counties with an unemployment spike, correlated with low income and high
hazard risk — so the event engine, experiment engine and scoring pipeline
have signal to find and tests can assert on it.

Run: python -m scripts.generate_sample_fixtures
"""

from __future__ import annotations

import csv
import json
import random
from datetime import date
from pathlib import Path

from engine.config import FIXTURES_DIR, SEEDS_DIR

SEED = 20260101
MONTHS = 42  # 3.5 years of monthly history
END = (2025, 12)

# Counties that experience an unemployment spike (>= +2pp over 12 months).
# Staggered onset so the time-based train/test split sees cases on both sides.
SPIKE_COUNTIES = {
    "22071": 26, "28049": 27, "26163": 28, "54039": 28, "01073": 29,   # train side
    "22017": 36, "39035": 37, "46102": 38, "05119": 38, "22103": 39,   # test side
}


def month_seq(n: int, end: tuple[int, int]) -> list[tuple[int, int]]:
    y, m = end
    out = []
    for _ in range(n):
        out.append((y, m))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return list(reversed(out))


def load_counties() -> list[dict]:
    with (SEEDS_DIR / "counties_fixture.csv").open() as fh:
        return list(csv.DictReader(fh))


def gen_bls_laus(counties: list[dict], rng: random.Random, out: Path) -> None:
    months = month_seq(MONTHS, END)
    rows = []
    for c in counties:
        fips = c["county_fips"]
        base_rate = rng.uniform(2.8, 6.0)
        # low-income/high-risk counties sit structurally higher
        if fips in SPIKE_COUNTIES:
            base_rate += rng.uniform(0.5, 1.5)
        labor_force = rng.randint(8_000, 900_000)
        spike_at = SPIKE_COUNTIES.get(fips)
        for i, (y, m) in enumerate(months):
            rate = base_rate + 0.4 * (i / MONTHS) * rng.uniform(-1, 1) + rng.gauss(0, 0.15)
            if spike_at is not None and i >= spike_at - 6:
                # ramp +3pp over the six months before (and after) onset
                ramp = min(1.0, (i - (spike_at - 6)) / 6.0)
                rate += 3.0 * ramp
            rate = max(1.0, round(rate, 1))
            unemployed = int(labor_force * rate / 100)
            rows.append(
                {
                    "laus_code": f"CN{fips}00000000",
                    "state_fips": fips[:2],
                    "county_fips": fips[2:],
                    "area_title": f"{c['county_equivalent_name']}, {c['state_abbr']}",
                    "year": y,
                    "month": m,
                    "labor_force": labor_force,
                    "employed": labor_force - unemployed,
                    "unemployed": unemployed,
                    "unemployment_rate": rate,
                }
            )
    with out.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def gen_census_acs(counties: list[dict], rng: random.Random, out: Path) -> None:
    header = ["NAME", "B19013_001E", "B01003_001E", "B17001_002E", "B25064_001E",
              "state", "county"]
    data = [header]
    for c in counties:
        fips = c["county_fips"]
        income = rng.randint(52_000, 95_000)
        if fips in SPIKE_COUNTIES:
            income = rng.randint(38_000, 55_000)   # planted signal: spikes hit poorer counties
        population = rng.randint(25_000, 2_500_000)
        poverty = int(population * rng.uniform(0.08, 0.16))
        if fips in SPIKE_COUNTIES:
            poverty = int(population * rng.uniform(0.17, 0.26))
        rent = rng.randint(750, 2100)
        data.append(
            [f"{c['county_equivalent_name']}, {c['state_name']}",
             str(income), str(population), str(poverty), str(rent),
             fips[:2], fips[2:]]
        )
    out.write_text(json.dumps({"year": 2023, "data": data}, indent=1))


def gen_fema_nri(counties: list[dict], rng: random.Random, out: Path) -> None:
    fields = ["NRI_ID", "STCOFIPS", "STATE", "COUNTY", "NRI_VER", "RISK_SCORE",
              "RISK_RATNG", "EAL_SCORE", "SOVI_SCORE", "RESL_SCORE", "POPULATION"]
    rows = []
    for c in counties:
        fips = c["county_fips"]
        risk = rng.uniform(5, 55)
        sovi = rng.uniform(10, 60)
        if fips in SPIKE_COUNTIES:
            risk = rng.uniform(55, 95)             # planted signal: spikes hit riskier counties
            sovi = rng.uniform(55, 90)
        rows.append(
            {
                "NRI_ID": f"C{fips}",
                "STCOFIPS": fips,
                "STATE": c["state_name"],
                "COUNTY": c["county_name"],
                "NRI_VER": "March 2023",
                "RISK_SCORE": round(risk, 2),
                "RISK_RATNG": "Relatively High" if risk > 50 else "Relatively Moderate",
                "EAL_SCORE": round(min(100, risk * rng.uniform(0.8, 1.1)), 2),
                "SOVI_SCORE": round(sovi, 2),
                "RESL_SCORE": round(rng.uniform(30, 70), 2),
                "POPULATION": rng.randint(25_000, 2_500_000),
            }
        )
    with out.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    counties = load_counties()
    rng = random.Random(SEED)
    gen_bls_laus(counties, rng, FIXTURES_DIR / "bls_laus_sample.csv")
    gen_census_acs(counties, rng, FIXTURES_DIR / "census_acs_sample.json")
    gen_fema_nri(counties, rng, FIXTURES_DIR / "fema_nri_sample.csv")
    print(f"fixtures written to {FIXTURES_DIR}")


if __name__ == "__main__":
    main()
