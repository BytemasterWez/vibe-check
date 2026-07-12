.PHONY: help install lint type test test-live migrate up down logs smoke fmt

help:
	@echo "RepoForge targets:"
	@echo "  install    Install app + dev deps into the current environment"
	@echo "  lint       Ruff lint"
	@echo "  fmt        Ruff format"
	@echo "  type       mypy on the core application"
	@echo "  test       Run unit + integration tests (no live GitHub calls)"
	@echo "  test-live  Run the explicitly-invoked live GitHub smoke test"
	@echo "  up         docker compose up --build -d"
	@echo "  down       docker compose down"
	@echo "  logs       Tail application logs"
	@echo "  migrate    Apply Alembic migrations (inside the app container)"
	@echo "  smoke      Run the local metadata smoke test script"

install:
	pip install -e ".[dev]"

lint:
	ruff check app tests

fmt:
	ruff format app tests

type:
	mypy app

test:
	pytest

test-live:
	pytest -m live

up:
	docker compose up --build -d

down:
	docker compose down

logs:
	docker compose logs -f app

migrate:
	docker compose exec app alembic upgrade head

smoke:
	python scripts/smoke_metadata.py
