.PHONY: up down migrate seed sample-pipeline test test-integration lint

up:
	docker compose up -d --build

down:
	docker compose down

migrate:
	docker compose exec api python -m scripts.migrate

seed:
	docker compose exec api python -m scripts.seed_ref

# Prove the architecture end-to-end on bundled samples (no network needed)
sample-pipeline:
	docker compose exec api python -m scripts.run_pipeline --source bls_laus --mode sample
	docker compose exec api python -m scripts.run_pipeline --source census_acs --mode sample
	docker compose exec api python -m scripts.run_pipeline --source fema_nri --mode sample
	docker compose exec api python -m scripts.run_features
	docker compose exec api python -m scripts.run_event --event unemployment_spike_2pp_12m
	docker compose exec api python -m scripts.run_experiment --event unemployment_spike_2pp_12m
	docker compose exec api python -m scripts.run_scoring --recipe labour_shock_monitor

test:
	pytest tests/unit -q

test-integration:
	pytest tests/integration -q -m integration

lint:
	ruff check engine adapters services scripts tests
