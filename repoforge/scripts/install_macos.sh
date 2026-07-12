#!/usr/bin/env bash
# RepoForge macOS installer / preflight helper.
# Idempotent: safe to re-run. It never overwrites an existing .env or data.
set -euo pipefail

VOL="${REPOFORGE_VOLUME:-/Volumes/RepoForge}"
APP_DIR="${REPOFORGE_APP_DIR:-${VOL}/repoforge}"
DATA_DIR="${REPOFORGE_DATA_DIR:-${VOL}/repoforge-data}"

say() { printf "\n\033[1m==> %s\033[0m\n" "$*"; }
warn() { printf "\033[33m[warn] %s\033[0m\n" "$*"; }
die() { printf "\033[31m[error] %s\033[0m\n" "$*" >&2; exit 1; }

say "1/8  Checking the external drive at ${VOL}"
[ -d "${VOL}" ] || die "Volume ${VOL} not found. Plug in and mount the RepoForge drive."

say "2/8  Confirming the filesystem is APFS (required for PostgreSQL)"
FS="$(diskutil info "${VOL}" 2>/dev/null | awk -F: '/File System Personality/ {gsub(/^ +/,"",$2); print tolower($2)}')"
echo "    detected filesystem: ${FS:-unknown}"
case "${FS}" in
  *apfs*) echo "    OK: APFS" ;;
  *exfat*|*fat*|*ntfs*) die "Filesystem is '${FS}'. PostgreSQL must NOT run on it. Reformat as APFS." ;;
  *) warn "Could not confirm APFS. Proceed only if you are sure the volume is APFS." ;;
esac

say "3/8  Creating data directories"
mkdir -p "${DATA_DIR}"/{postgres,cache,dossiers,backups,tmp}
# Marker proves the real external volume is mounted (guards against an empty
# mount-point being silently created on the internal disk).
touch "${DATA_DIR}/.repoforge_volume"
echo "    created ${DATA_DIR}/{postgres,cache,dossiers,backups,tmp}"

say "4/8  Creating the environment file"
if [ -f "${APP_DIR}/.env" ]; then
  warn ".env already exists — leaving it untouched."
else
  cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
  # Generate a strong admin token and a Postgres password if unset.
  ADMIN="$(openssl rand -hex 24)"
  PGPW="$(openssl rand -hex 16)"
  /usr/bin/sed -i '' "s|^ADMIN_TOKEN=.*|ADMIN_TOKEN=${ADMIN}|" "${APP_DIR}/.env"
  /usr/bin/sed -i '' "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PGPW}|" "${APP_DIR}/.env"
  /usr/bin/sed -i '' "s|^REPOFORGE_DATA_DIR=.*|REPOFORGE_DATA_DIR=${DATA_DIR}|" "${APP_DIR}/.env"
  echo "    wrote ${APP_DIR}/.env with generated ADMIN_TOKEN and POSTGRES_PASSWORD"
  echo "    ACTION REQUIRED: add your GITHUB_TOKEN (and optional Telegram creds) to .env"
fi

say "5/8  Checking native Ollama (for local_ai mode)"
if command -v ollama >/dev/null 2>&1; then
  echo "    ollama found: $(ollama --version 2>/dev/null | head -1)"
  echo "    available models:"; ollama list 2>/dev/null || warn "could not list models"
  echo "    Suggested (pull only what you want, avoid huge models):"
  echo "      ollama pull nomic-embed-text     # embeddings (~275MB)"
  echo "      ollama pull qwen2.5:7b-instruct  # classifier (~4.7GB)"
else
  warn "ollama not installed. Install from https://ollama.com, or run REPOFORGE_MODE=metadata."
fi

say "6/8  Checking Docker"
command -v docker >/dev/null 2>&1 || die "Docker not found. Install Docker Desktop for Mac."
docker info >/dev/null 2>&1 || die "Docker daemon not running. Start Docker Desktop."
echo "    docker OK"

say "7/8  Preventing sleep so the drive and DB stay available"
echo "    Recommended (run in a login item or Terminal): caffeinate -dimsu &"
echo "    Also: System Settings > Displays > Advanced > 'Prevent automatic sleeping'"
echo "    And:  System Settings > Energy > 'Put hard disks to sleep when possible' OFF"

say "8/8  Ready to build"
cat <<EOF
    Next steps (copy-paste):
      cd ${APP_DIR}
      docker compose up --build -d      # build + start (migrations auto-apply)
      curl -fsS http://localhost:18765/health
      open http://localhost:18765       # dashboard
      make test-live                    # optional: live GitHub smoke test (needs GITHUB_TOKEN)
EOF
