#!/usr/bin/env bash
# CapabilityProof VPS installer — one command to run the system 24/7.
#
#   sudo bash capabilityproof/ops/install.sh [--with-ollama] [--model qwen2.5:3b]
#
# Sets up, on a fresh Ubuntu/Debian VPS:
#   - Node.js 22 (if missing) and the app under /opt/capabilityproof
#   - systemd service: REST API + dashboard on port 3200 (auto-restart on crash)
#   - systemd timer:   daily verification sweep + quarantine sweep + Telegram report
#   - systemd timer:   doctor watchdog every 15 minutes
#   - optional:        Ollama with a small local model for Scout drafting
#
# After install, put your Telegram credentials in /etc/capabilityproof.env
# and run:  node /opt/capabilityproof/capabilityproof/report.mjs test

set -euo pipefail

WITH_OLLAMA=0
OLLAMA_MODEL="qwen2.5:3b"   # smallest model that drafts reliable JSON; try gemma3:4b to stay in the Gemma family
REPO_URL="${CAPABILITYPROOF_REPO:-https://github.com/BytemasterWez/vibe-check.git}"
APP_DIR="/opt/capabilityproof"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-ollama) WITH_OLLAMA=1; shift ;;
    --model) OLLAMA_MODEL="$2"; shift 2 ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash capabilityproof/ops/install.sh"
  exit 1
fi

echo "==> Installing prerequisites"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates >/dev/null

if ! command -v node >/dev/null || [[ "$(node -v | cut -c2-3)" -lt 20 ]]; then
  echo "==> Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "    node $(node -v)"

echo "==> Fetching the app into ${APP_DIR}"
if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "${APP_DIR}" pull --ff-only
else
  git clone --depth 1 "${REPO_URL}" "${APP_DIR}"
fi
cd "${APP_DIR}"
npm ci --ignore-scripts --omit=dev >/dev/null 2>&1 || npm ci --ignore-scripts >/dev/null

echo "==> Creating service user and env file"
id -u capproof >/dev/null 2>&1 || useradd --system --home "${APP_DIR}" --shell /usr/sbin/nologin capproof
chown -R capproof:capproof "${APP_DIR}"

if [[ ! -f /etc/capabilityproof.env ]]; then
  cat > /etc/capabilityproof.env <<'ENV'
# CapabilityProof configuration — fill in and then: systemctl restart capabilityproof-api
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
CAPABILITYPROOF_PORT=3200
# Uncomment to require an API key on /v1/* routes:
#CAPABILITYPROOF_API_KEY=change-me
# Local LLM for Scout drafting (Ollama's OpenAI-compatible endpoint):
CAPABILITYPROOF_LLM_URL=http://localhost:11434/v1
# Free Census key (https://api.census.gov/data/key_signup.html):
#CENSUS_API_KEY=
ENV
  chmod 600 /etc/capabilityproof.env
fi

echo "==> Installing systemd units"
cat > /etc/systemd/system/capabilityproof-api.service <<UNIT
[Unit]
Description=CapabilityProof REST API + dashboard
After=network-online.target
Wants=network-online.target

[Service]
User=capproof
WorkingDirectory=${APP_DIR}
EnvironmentFile=/etc/capabilityproof.env
ExecStart=/usr/bin/node capabilityproof/api.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/capabilityproof-sweep.service <<UNIT
[Unit]
Description=CapabilityProof daily sweep, quarantine sweep and Telegram report

[Service]
Type=oneshot
User=capproof
WorkingDirectory=${APP_DIR}
EnvironmentFile=/etc/capabilityproof.env
ExecStart=/bin/bash -c 'node capabilityproof/cli.mjs verify-all --skip-missing-env; node capabilityproof/scout.mjs verify-proposed; node capabilityproof/scout.mjs promote --ready; node capabilityproof/report.mjs daily'
UNIT

cat > /etc/systemd/system/capabilityproof-sweep.timer <<'UNIT'
[Unit]
Description=Run the CapabilityProof sweep daily

[Timer]
OnCalendar=*-*-* 06:15:00 UTC
RandomizedDelaySec=600
Persistent=true

[Install]
WantedBy=timers.target
UNIT

cat > /etc/systemd/system/capabilityproof-doctor.service <<UNIT
[Unit]
Description=CapabilityProof doctor watchdog

[Service]
Type=oneshot
User=root
WorkingDirectory=${APP_DIR}
EnvironmentFile=/etc/capabilityproof.env
ExecStart=/usr/bin/node capabilityproof/doctor.mjs
UNIT

cat > /etc/systemd/system/capabilityproof-doctor.timer <<'UNIT'
[Unit]
Description=Run the CapabilityProof doctor every 15 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min

[Install]
WantedBy=timers.target
UNIT

if [[ "${WITH_OLLAMA}" -eq 1 ]]; then
  echo "==> Installing Ollama + pulling ${OLLAMA_MODEL} (this downloads a few GB)"
  command -v ollama >/dev/null || curl -fsSL https://ollama.com/install.sh | sh
  systemctl enable --now ollama
  ollama pull "${OLLAMA_MODEL}"
  echo "CAPABILITYPROOF_LLM_MODEL=${OLLAMA_MODEL}" >> /etc/capabilityproof.env

  cat > /etc/systemd/system/capabilityproof-scout.service <<UNIT
[Unit]
Description=CapabilityProof Scout discovery (LLM-drafted)
After=ollama.service

[Service]
Type=oneshot
User=capproof
WorkingDirectory=${APP_DIR}
EnvironmentFile=/etc/capabilityproof.env
ExecStart=/usr/bin/node capabilityproof/scout.mjs discover
UNIT

  cat > /etc/systemd/system/capabilityproof-scout.timer <<'UNIT'
[Unit]
Description=Run Scout discovery weekly

[Timer]
OnCalendar=Mon *-*-* 07:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  systemctl enable --now capabilityproof-scout.timer
fi

systemctl daemon-reload
systemctl enable --now capabilityproof-api.service capabilityproof-sweep.timer capabilityproof-doctor.timer

echo
echo "==> Done. Next steps:"
echo "  1. Put your Telegram token + chat id in /etc/capabilityproof.env"
echo "     (setup helper: node ${APP_DIR}/capabilityproof/report.mjs setup-telegram)"
echo "  2. Test alerts:      sudo -u capproof bash -c 'set -a; . /etc/capabilityproof.env; node ${APP_DIR}/capabilityproof/report.mjs test'"
echo "  3. Dashboard:        http://<this-server>:3200/"
echo "  4. Force a sweep:    systemctl start capabilityproof-sweep.service"
echo "  5. Doctor now:       systemctl start capabilityproof-doctor.service"
