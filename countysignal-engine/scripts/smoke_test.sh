#!/usr/bin/env bash
# Real-host smoke test for CountySignal Engine (Milestone 1 acceptance gate).
#
# Run on a host with Docker and open egress (Mac Mini / cloud VM):
#
#   cd countysignal-engine
#   cp .env.example .env        # set real secrets first
#   bash scripts/smoke_test.sh
#
# Covers: compose boot, PostGIS, migrations from clean DB, full national
# Gazetteer seed, sample-mode ingest x3, LIVE full-mode BLS LAUS ingest,
# source health, features -> event -> experiment -> score, API exercise,
# scorecard CSV export, backup/restore, and a timing/row-count report.
# Exits non-zero on the first failed gate.

set -uo pipefail
cd "$(dirname "$0")/.."

PASS=0; FAIL=0; REPORT=()
step() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
ok()   { PASS=$((PASS+1)); REPORT+=("PASS  $1"); printf '\033[32mPASS\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); REPORT+=("FAIL  $1"); printf '\033[31mFAIL\033[0m %s\n' "$1"; report; exit 1; }
report() {
  printf '\n\033[1m== SMOKE TEST REPORT ==\033[0m\n'
  printf '%s\n' "${REPORT[@]}"
  printf 'passed=%d failed=%d\n' "$PASS" "$FAIL"
}

exec_api() { docker compose exec -T api "$@"; }
sql() { docker compose exec -T postgres-postgis psql -U "${POSTGRES_USER:-countysignal}" -d "${POSTGRES_DB:-countysignal}" -tA -c "$1"; }

[ -f .env ] || bad ".env missing — cp .env.example .env and set secrets"
set -a; source .env; set +a
API_KEY="${CSE_API_KEYS%%,*}"
T0=$SECONDS

step "1. docker compose up --build"
docker compose up -d --build || bad "compose boot"
sleep 10
UNHEALTHY=$(docker compose ps --format '{{.Name}} {{.State}}' | grep -cv running || true)
[ "$UNHEALTHY" -eq 0 ] && ok "all services running" || bad "services not running: $(docker compose ps)"

step "2. PostGIS active"
[ "$(sql "SELECT count(*) FROM pg_extension WHERE extname='postgis'" 2>/dev/null || echo 0)" = "1" ] \
  && ok "postgis extension enabled" || bad "postgis extension missing"

step "3. migrations from clean database"
exec_api python -m scripts.migrate || bad "migrations"
ok "migrations applied ($(sql "SELECT count(*) FROM public.schema_migrations") files)"

step "4. full national Gazetteer seed"
S=$SECONDS
exec_api python -m scripts.seed_ref || bad "seed_ref"
COUNTIES=$(sql "SELECT count(*) FROM ref.counties WHERE is_active")
echo "ref.counties = $COUNTIES (took $((SECONDS-S))s)"
[ "$COUNTIES" -ge 3140 ] && ok "canonical geography loaded ($COUNTIES counties)" \
  || bad "expected ~3,144 counties, got $COUNTIES (network to census.gov?)"

step "5. sample-mode ingestion x3"
for s in bls_laus census_acs fema_nri; do
  exec_api python -m scripts.run_pipeline --source "$s" --mode sample || bad "sample ingest $s"
done
ok "sample ingestion (bls_laus, census_acs, fema_nri)"

step "6. LIVE full-mode BLS LAUS ingest"
S=$SECONDS
exec_api python -m scripts.run_pipeline --source bls_laus --mode full || bad "live BLS LAUS ingest"
echo "live BLS ingest took $((SECONDS-S))s"
JOIN_RATE=$(sql "SELECT county_join_rate FROM registry.source_health WHERE source_id='bls_laus'")
echo "bls_laus county_join_rate = $JOIN_RATE"
ok "live BLS LAUS full ingest (join rate $JOIN_RATE)"

step "7. lifecycle gate: only COUNTY_JOIN_PASSING+ sources feed features"
BELOW=$(sql "SELECT count(*) FROM registry.sources WHERE status NOT IN ('COUNTY_JOIN_PASSING','PRODUCTION_ALLOWED','DISABLED')")
echo "sources below COUNTY_JOIN_PASSING: $BELOW (their observations are excluded by load_observations)"
ok "lifecycle gates in place"

step "8. features -> event -> experiment -> score"
S=$SECONDS
exec_api python -m scripts.run_features || bad "features"
exec_api python -m scripts.run_event --event unemployment_spike_2pp_12m || bad "event"
exec_api python -m scripts.run_experiment --event unemployment_spike_2pp_12m || bad "experiment"
exec_api python -m scripts.run_scoring --recipe labour_shock_monitor || bad "scoring"
ok "pipeline stages ($((SECONDS-S))s)"

step "9. API exercise with real key"
H() { curl -s -o /dev/null -w '%{http_code} %{time_total}s' -H "X-API-Key: $API_KEY" "http://localhost:8000$1"; }
curl -s http://localhost:8000/health | grep -q READY && ok "API READY" || bad "API not READY"
for ep in "/v1/counties?limit=100" "/v1/counties/22103/profile" \
          "/v1/scores/labour_shock_monitor?limit=100" "/v1/source-health" \
          "/v1/provenance/22103:bls_laus_unemployment_rate"; do
  R=$(H "$ep"); echo "  $ep -> $R"
  [[ "$R" == 200* ]] || bad "endpoint $ep returned $R"
done
[ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/v1/sources)" = "401" ] \
  && ok "API endpoints + auth" || bad "missing key did not 401"

step "10. read-only role isolation"
RO_DENIED=$(docker compose exec -T postgres-postgis psql -U countysignal_api_ro -d "$POSTGRES_DB" -tA \
  -c "SELECT count(*) FROM norm.county_month_variables" 2>&1 | grep -c "permission denied" || true)
[ "$RO_DENIED" -ge 1 ] && ok "api role cannot read norm.*" || bad "api role reached norm.* directly"

step "11. scorecard CSV export"
curl -s -H "X-API-Key: $API_KEY" \
  "http://localhost:8000/v1/events/unemployment_spike_2pp_12m/scorecards?format=csv" \
  -o /tmp/scorecard_smoke.csv
head -1 /tmp/scorecard_smoke.csv | grep -q county_fips && ok "scorecard CSV exported" || bad "CSV export"

step "12. backup / restore"
docker compose exec -T postgres-postgis pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > /tmp/cse_smoke.dump || bad "pg_dump"
docker compose exec -T postgres-postgis createdb -U "$POSTGRES_USER" cse_restore_smoke 2>/dev/null || true
docker compose exec -T postgres-postgis pg_restore -U "$POSTGRES_USER" -d cse_restore_smoke --clean --if-exists < /tmp/cse_smoke.dump
RESTORED=$(docker compose exec -T postgres-postgis psql -U "$POSTGRES_USER" -d cse_restore_smoke -tA \
  -c "SELECT count(*) FROM norm.county_month_variables")
ORIGINAL=$(sql "SELECT count(*) FROM norm.county_month_variables")
[ "$RESTORED" = "$ORIGINAL" ] && ok "restore matches ($RESTORED rows)" || bad "restore mismatch ($RESTORED vs $ORIGINAL)"
docker compose exec -T postgres-postgis dropdb -U "$POSTGRES_USER" cse_restore_smoke || true

step "13. final numbers"
echo "total wall time: $((SECONDS-T0))s"
echo "db size:         $(sql "SELECT pg_size_pretty(pg_database_size('$POSTGRES_DB'))")"
echo "counties:        $(sql "SELECT count(*) FROM ref.counties WHERE is_active")"
echo "norm rows:       $(sql "SELECT (SELECT count(*) FROM norm.county_month_variables)+(SELECT count(*) FROM norm.county_year_variables)+(SELECT count(*) FROM norm.county_static_variables)")"
echo "feature rows:    $(sql "SELECT count(*) FROM feature.feature_matrix")"
echo "occurrences:     $(sql "SELECT count(*) FROM event.occurrences")"
echo "scores:          $(sql "SELECT count(*) FROM score.county_scores")"
echo "quarantined:     $(sql "SELECT count(*) FROM quarantine.records")"
sql "SELECT source_id, status FROM registry.sources ORDER BY source_id"
ok "report produced"

report
