"""Full-stack integration test against a live Postgres.

Requires CSE_DATABASE_URL pointing at an empty (or disposable) database:

    export CSE_DATABASE_URL=postgresql+psycopg2://countysignal:cse@localhost:5432/countysignal
    pytest tests/integration -m integration

Covers the acceptance-criteria path: migrate → seed → ingest 3 sources →
features → event → experiment → scores → API views (via read-only queries).
"""

from __future__ import annotations

import os
import subprocess
import sys

import pytest
from sqlalchemy import create_engine, text

pytestmark = pytest.mark.integration

DB_URL = os.environ.get("CSE_DATABASE_URL", "")
needs_db = pytest.mark.skipif(not DB_URL, reason="CSE_DATABASE_URL not set")


def run(module: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-m", module, *args],
                          capture_output=True, text=True, check=False)


@pytest.fixture(scope="module")
def stack(tmp_path_factory):
    if not DB_URL:
        pytest.skip("CSE_DATABASE_URL not set")
    env_raw = tmp_path_factory.mktemp("raw")
    os.environ.setdefault("CSE_OBJECT_STORE", "local")
    os.environ.setdefault("CSE_RAW_DIR", str(env_raw))

    assert run("scripts.migrate").returncode == 0
    assert run("scripts.seed_ref", "--fixture").returncode == 0
    for source in ("bls_laus", "census_acs", "fema_nri"):
        p = run("scripts.run_pipeline", "--source", source, "--mode", "sample")
        assert p.returncode == 0, p.stdout + p.stderr
    assert run("scripts.run_features").returncode == 0
    assert run("scripts.run_event", "--event", "unemployment_spike_2pp_12m").returncode == 0
    assert run("scripts.run_experiment", "--event", "unemployment_spike_2pp_12m").returncode == 0
    assert run("scripts.run_scoring", "--recipe", "labour_shock_monitor").returncode == 0
    return create_engine(DB_URL)


@needs_db
def test_acceptance_criteria_queries(stack):
    with stack.connect() as conn:
        def one(sql):
            return conn.execute(text(sql)).fetchone()[0]

        # source registry populated; raw artifacts hashed; provenance intact
        assert one("SELECT count(*) FROM registry.sources") >= 3
        assert one("SELECT count(*) FROM raw.files WHERE length(content_hash) = 64") >= 3
        assert one("""SELECT count(*) FROM norm.county_month_variables
                      WHERE provenance_json ? 'raw_artifact_id'""") > 0

        # join rate reported; variable dictionary; feature matrix
        assert one("SELECT count(*) FROM audit.join_quality WHERE match_rate = 1.0") >= 3
        assert one("SELECT count(*) FROM norm.variable_dictionary") >= 12
        assert one("SELECT count(*) FROM feature.feature_matrix") > 10000

        # event reproduced; experiment has AUC + rankings; scores ranked
        assert one("""SELECT count(*) FROM event.occurrences
                      WHERE event_id = 'unemployment_spike_2pp_12m'""") > 0
        assert one("""SELECT count(*) FROM experiment.metrics WHERE metric = 'auc'""") > 0
        assert one("SELECT count(*) FROM experiment.variable_rankings") > 0
        assert one("""SELECT count(*) FROM score.county_scores
                      WHERE rank_national = 1""") >= 1

        # API views serve
        assert one("SELECT count(*) FROM api.county_profile") >= 60
        assert one("SELECT count(*) FROM api.county_signal_pack") > 0
        assert one("SELECT count(*) FROM api.source_health") >= 3
        assert one("SELECT count(*) FROM api.provenance LIMIT 1") is not None

        # read-only role exists and cannot see internal schemas
        grants = conn.execute(text(
            """SELECT table_schema, privilege_type
               FROM information_schema.role_table_grants
               WHERE grantee = 'countysignal_api_ro'""")).fetchall()
        schemas = {g.table_schema for g in grants}
        assert schemas <= {"api", "audit"}
        assert all(g.privilege_type == "SELECT" for g in grants if g.table_schema == "api")
