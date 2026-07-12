#!/usr/bin/env bash
# Daily PostgreSQL backup with retention and verification.
# Backups are written to $REPOFORGE_DATA_DIR/backups on the external volume.
set -euo pipefail

: "${REPOFORGE_DATA_DIR:=/Volumes/RepoForge/repoforge-data}"
: "${POSTGRES_USER:=repoforge}"
: "${POSTGRES_DB:=repoforge}"
: "${BACKUP_RETENTION_DAYS:=14}"

BACKUP_DIR="${REPOFORGE_DATA_DIR}/backups"
mkdir -p "${BACKUP_DIR}"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="${BACKUP_DIR}/repoforge_${STAMP}.sql.gz"

echo "[backup] dumping ${POSTGRES_DB} -> ${OUT}"
docker compose exec -T db pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${OUT}"

# Verify the dump is a non-empty, valid gzip that contains DDL.
echo "[backup] verifying ${OUT}"
if ! gzip -t "${OUT}"; then
  echo "[backup] FAILED gzip integrity check" >&2
  exit 1
fi
if ! gunzip -c "${OUT}" | head -n 50 | grep -q "PostgreSQL database dump"; then
  echo "[backup] FAILED content check (no dump header)" >&2
  exit 1
fi
SIZE=$(wc -c < "${OUT}")
echo "[backup] ok: ${OUT} (${SIZE} bytes)"

echo "[backup] pruning backups older than ${BACKUP_RETENTION_DAYS} days"
find "${BACKUP_DIR}" -name 'repoforge_*.sql.gz' -type f \
  -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete

echo "[backup] done"
