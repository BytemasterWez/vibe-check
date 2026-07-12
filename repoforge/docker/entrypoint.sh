#!/usr/bin/env bash
# Entrypoint: wait for the DB, apply migrations, then start the API server.
# Migrations run at startup (idempotent) so a fresh volume is always ready.
set -euo pipefail

: "${POSTGRES_HOST:=db}"
: "${POSTGRES_PORT:=5432}"
: "${REPOFORGE_PORT:=18765}"

echo "[entrypoint] waiting for postgres at ${POSTGRES_HOST}:${POSTGRES_PORT}..."
for i in $(seq 1 60); do
  if python -c "import socket,sys; s=socket.socket(); s.settimeout(2);
sys.exit(0) if s.connect_ex(('${POSTGRES_HOST}', ${POSTGRES_PORT}))==0 else sys.exit(1)"; then
    echo "[entrypoint] postgres is up"
    break
  fi
  sleep 2
  if [ "$i" -eq 60 ]; then
    echo "[entrypoint] postgres never became reachable" >&2
    exit 1
  fi
done

echo "[entrypoint] applying migrations..."
alembic upgrade head

echo "[entrypoint] starting API on :${REPOFORGE_PORT}"
exec uvicorn app.main:app --host 0.0.0.0 --port "${REPOFORGE_PORT}"
