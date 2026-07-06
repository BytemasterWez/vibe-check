"""Seed canonical reference geography: ref.states, ref.counties,
ref.geography_aliases, ref.fips_crosswalks.

For full national coverage this downloads the Census Gazetteer counties
file (3,144 county-equivalents, 2023 vintage). If the network is
unavailable — or --fixture is passed — it seeds the bundled fixture subset
(64 counties, one per state + validation counties) so the pipeline is
runnable offline. Geometry loading (TIGER shapefiles) is deployment-time:
see docs/deployment.md.

Run: python -m scripts.seed_ref [--fixture]
"""

from __future__ import annotations

import argparse
import csv
import io
import sys
import zipfile

import httpx
from sqlalchemy import text

from engine.config import SEEDS_DIR
from engine.db import get_engine

GAZETTEER_URL = (
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/"
    "2023_Gazetteer/2023_Gaz_counties_national.zip"
)

COUNTY_TYPE_BY_SUFFIX = [
    ("Parish", "parish"),
    ("Borough", "borough"),
    ("Census Area", "census_area"),
    ("City and Borough", "city_and_borough"),
    ("Municipality", "municipality"),
    ("Planning Region", "planning_region"),
    ("city", "independent_city"),
    ("County", "county"),
]


def classify(name: str) -> tuple[str, str]:
    for suffix, ctype in COUNTY_TYPE_BY_SUFFIX:
        if name.endswith(suffix):
            bare = name[: -len(suffix)].strip()
            return (bare or name, ctype)
    return name, "county"


def seed_states(conn) -> dict[str, dict]:
    states = {}
    with (SEEDS_DIR / "states.csv").open() as fh:
        for row in csv.DictReader(fh):
            states[row["state_fips"]] = row
            conn.execute(text(
                """INSERT INTO ref.states (state_fips, state_abbr, state_name, is_state)
                   VALUES (:state_fips, :state_abbr, :state_name, :is_state)
                   ON CONFLICT (state_fips) DO NOTHING"""),
                {**row, "is_state": row["is_state"] == "true"})
    return states


def _has_postgis(conn) -> bool:
    return bool(conn.execute(text(
        "SELECT 1 FROM pg_extension WHERE extname = 'postgis'")).fetchone())


def _insert_county(conn, row: dict) -> None:
    conn.execute(text(
        """INSERT INTO ref.counties (county_fips, state_fips, state_abbr, state_name,
               county_name, county_type, county_equivalent_name,
               centroid_lat, centroid_lon, land_area, water_area)
           VALUES (:county_fips, :state_fips, :state_abbr, :state_name, :county_name,
                   :county_type, :county_equivalent_name, :lat, :lon,
                   :land_area, :water_area)
           ON CONFLICT (county_fips) DO NOTHING"""), row)


def _fill_centroids(conn) -> None:
    if _has_postgis(conn):
        conn.execute(text(
            """UPDATE ref.counties
               SET centroid = ST_SetSRID(ST_MakePoint(centroid_lon, centroid_lat), 4326)
               WHERE centroid IS NULL AND centroid_lon IS NOT NULL"""))


def seed_counties_fixture(conn) -> int:
    n = 0
    with (SEEDS_DIR / "counties_fixture.csv").open() as fh:
        for row in csv.DictReader(fh):
            _insert_county(conn, {
                "county_fips": row["county_fips"], "state_fips": row["state_fips"],
                "state_abbr": row["state_abbr"], "state_name": row["state_name"],
                "county_name": row["county_name"], "county_type": row["county_type"],
                "county_equivalent_name": row["county_equivalent_name"],
                "lat": float(row["lat"]), "lon": float(row["lon"]),
                "land_area": float(row["land_area"]),
                "water_area": float(row["water_area"])})
            n += 1
    return n


def seed_counties_gazetteer(conn, states: dict[str, dict]) -> int:
    resp = httpx.get(GAZETTEER_URL, timeout=180.0, follow_redirects=True)
    resp.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        raw = zf.read(zf.namelist()[0]).decode("utf-8", errors="replace")
    n = 0
    for row in csv.DictReader(io.StringIO(raw), delimiter="\t"):
        row = {k.strip(): (v.strip() if v else v) for k, v in row.items()}
        geoid = row["GEOID"].zfill(5)
        state_fips = geoid[:2]
        state = states.get(state_fips)
        if state is None:      # territories are out of the canonical set
            continue
        bare, ctype = classify(row["NAME"])
        _insert_county(conn, {
            "county_fips": geoid, "state_fips": state_fips,
            "state_abbr": state["state_abbr"], "state_name": state["state_name"],
            "county_name": bare, "county_type": ctype,
            "county_equivalent_name": row["NAME"],
            "lat": float(row["INTPTLAT"]), "lon": float(row["INTPTLONG"]),
            "land_area": float(row["ALAND"]), "water_area": float(row["AWATER"])})
        n += 1
    return n


def seed_aliases_and_crosswalks(conn) -> None:
    with (SEEDS_DIR / "geography_aliases.csv").open() as fh:
        for row in csv.DictReader(fh):
            conn.execute(text(
                """INSERT INTO ref.geography_aliases (county_fips, alias_name,
                       alias_scope, source_hint)
                   SELECT :county_fips, :alias_name, :alias_scope, :source_hint
                   WHERE EXISTS (SELECT 1 FROM ref.counties WHERE county_fips = :county_fips)
                   ON CONFLICT (county_fips, lower(alias_name)) DO NOTHING"""), row)
    with (SEEDS_DIR / "fips_crosswalks.csv").open() as fh:
        for row in csv.DictReader(fh):
            conn.execute(text(
                """INSERT INTO ref.fips_crosswalks (old_fips, new_fips, change_type,
                       effective_date, authority, notes)
                   SELECT :old_fips, :new_fips, :change_type, :effective_date,
                          :authority, :notes
                   WHERE EXISTS (SELECT 1 FROM ref.counties WHERE county_fips = :new_fips)
                   ON CONFLICT (old_fips, new_fips) DO NOTHING"""), row)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", action="store_true",
                        help="seed the bundled fixture subset (no network)")
    args = parser.parse_args()

    engine = get_engine()
    with engine.begin() as conn:
        states = seed_states(conn)
        if args.fixture:
            n = seed_counties_fixture(conn)
        else:
            try:
                n = seed_counties_gazetteer(conn, states)
            except Exception as exc:  # noqa: BLE001
                print(f"gazetteer download failed ({exc}); falling back to fixture subset",
                      file=sys.stderr)
                n = seed_counties_fixture(conn)
        seed_aliases_and_crosswalks(conn)
        _fill_centroids(conn)
        total = conn.execute(text("SELECT count(*) FROM ref.counties")).fetchone()[0]
    print(f"seeded {n} counties this run; ref.counties now has {total} rows")
    if total < 3100:
        print("NOTE: running on the fixture subset — full national coverage "
              "requires the Census Gazetteer download (see docs/deployment.md)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
