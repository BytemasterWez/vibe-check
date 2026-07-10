#!/usr/bin/env node

// Doctor: watchdog for unattended 24/7 operation.
//
// Distinguishes "a data source is broken" (normal — receipts and alerts
// already cover that) from "OUR system is broken" (sweep not running, API
// down, disk full, keys unreadable) and only escalates the second kind.
// Safe remediations are applied automatically (restart the API service);
// everything else becomes a Telegram alert.
//
//   node capabilityproof/doctor.mjs           run all checks, remediate, alert
//   node capabilityproof/doctor.mjs --dry-run run checks, no remediation/alerts
//
// Exit code 0 = healthy (or healed), 1 = unhealthy. Designed for a systemd
// timer every 15 minutes.

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { loadManifests } from './lib/manifest.mjs';
import { DEFAULT_MANIFEST_DIR, DEFAULT_DATA_DIR } from './lib/service.mjs';
import { ensureKeys } from './lib/receipts.mjs';
import { sendTelegram, telegramConfigured, formatEventMessage } from './lib/telegram.mjs';

const API_URL = process.env.CAPABILITYPROOF_API_CHECK_URL || `http://localhost:${process.env.CAPABILITYPROOF_PORT || 3200}`;
const SWEEP_MAX_AGE_HOURS = parseFloat(process.env.CAPABILITYPROOF_SWEEP_MAX_AGE_HOURS || '26');
const MIN_FREE_DISK_MB = parseInt(process.env.CAPABILITYPROOF_MIN_FREE_DISK_MB || '500', 10);
const API_SERVICE_NAME = process.env.CAPABILITYPROOF_API_SERVICE || 'capabilityproof-api';

const dryRun = process.argv.includes('--dry-run');
const results = [];

function record(name, ok, detail, { severity = 'critical', remediation = null } = {}) {
  results.push({ name, ok, detail, severity, remediation });
  console.log(`[${ok ? 'OK  ' : 'FAIL'}] ${name}: ${detail}${remediation ? ` (action: ${remediation})` : ''}`);
}

// 1. Manifests load and validate
try {
  const { manifests, problems } = loadManifests(DEFAULT_MANIFEST_DIR);
  record('manifests', manifests.size > 0 && problems.length === 0,
    `${manifests.size} manifests loaded, ${problems.length} problem(s)${problems.length ? ': ' + problems[0] : ''}`);
} catch (err) {
  record('manifests', false, err.message);
}

// 2. Data dir writable
try {
  fs.mkdirSync(DEFAULT_DATA_DIR, { recursive: true });
  const probe = path.join(DEFAULT_DATA_DIR, '.doctor-write-probe');
  fs.writeFileSync(probe, String(Date.now()));
  fs.unlinkSync(probe);
  record('data_dir_writable', true, DEFAULT_DATA_DIR);
} catch (err) {
  record('data_dir_writable', false, `cannot write to ${DEFAULT_DATA_DIR}: ${err.message}`);
}

// 3. Signing keys load
try {
  ensureKeys(DEFAULT_DATA_DIR);
  record('signing_keys', true, 'ed25519 keypair loads');
} catch (err) {
  record('signing_keys', false, `keys unreadable: ${err.message}`);
}

// 4. Disk space
try {
  const stat = fs.statfsSync(DEFAULT_DATA_DIR);
  const freeMb = Math.round((stat.bavail * stat.bsize) / 1048576);
  record('disk_space', freeMb >= MIN_FREE_DISK_MB, `${freeMb} MB free (minimum ${MIN_FREE_DISK_MB} MB)`);
} catch (err) {
  record('disk_space', true, `statfs unavailable (${err.message}) — skipped`);
}

// 5. Sweep recency: at least one receipt written within the window
try {
  const receiptsDir = path.join(DEFAULT_DATA_DIR, 'receipts');
  let newest = 0;
  if (fs.existsSync(receiptsDir)) {
    for (const f of fs.readdirSync(receiptsDir)) {
      const mtime = fs.statSync(path.join(receiptsDir, f)).mtimeMs;
      if (mtime > newest) newest = mtime;
    }
  }
  const ageHours = newest ? (Date.now() - newest) / 3600000 : Infinity;
  record('sweep_recency', ageHours <= SWEEP_MAX_AGE_HOURS,
    newest ? `latest receipt ${ageHours.toFixed(1)}h old (limit ${SWEEP_MAX_AGE_HOURS}h)` : 'no receipts found — sweep has never run',
    { severity: 'warning' });
} catch (err) {
  record('sweep_recency', false, err.message, { severity: 'warning' });
}

// 6. API liveness, with auto-restart via systemd when available
let apiOk = false;
try {
  const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(5000) });
  const body = await res.json();
  apiOk = res.ok && body.status === 'ok';
  record('api_health', apiOk, `${API_URL}/health -> HTTP ${res.status}`);
} catch (err) {
  let remediation = null;
  if (!dryRun) {
    try {
      execFileSync('systemctl', ['restart', API_SERVICE_NAME], { stdio: 'pipe', timeout: 20000 });
      await new Promise((r) => setTimeout(r, 3000));
      const retry = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      apiOk = Boolean(retry?.ok);
      remediation = apiOk ? `restarted ${API_SERVICE_NAME}, healthy again` : `restarted ${API_SERVICE_NAME}, still down`;
    } catch {
      remediation = 'systemd not available; cannot auto-restart';
    }
  }
  record('api_health', apiOk, `API unreachable at ${API_URL} (${err.message})`, { remediation });
}

// 7. LLM endpoint (informational only — the system works without it)
try {
  const llmUrl = process.env.CAPABILITYPROOF_LLM_URL || 'http://localhost:11434/v1';
  const res = await fetch(`${llmUrl}/models`, { signal: AbortSignal.timeout(5000) });
  const models = (await res.json()).data?.map((m) => m.id).slice(0, 3) || [];
  record('llm_endpoint', true, `reachable at ${llmUrl} (${models.join(', ') || 'no models loaded'})`, { severity: 'info' });
} catch {
  record('llm_endpoint', true, 'no local LLM reachable — Scout will use fallback drafting', { severity: 'info' });
}

// --- Escalation ---------------------------------------------------------------
const failures = results.filter((r) => !r.ok);
const critical = failures.filter((r) => r.severity === 'critical');

if (failures.length && !dryRun && telegramConfigured()) {
  for (const f of failures) {
    await sendTelegram(formatEventMessage({
      event: 'doctor_alert',
      severity: f.severity,
      title: f.name.replace(/_/g, ' '),
      detail: f.detail,
      remediation: f.remediation,
    }));
  }
}

console.log(`\ndoctor: ${results.length - failures.length}/${results.length} checks healthy${failures.length ? ` — ${critical.length} critical, ${failures.length - critical.length} warning(s)` : ''}`);
process.exitCode = critical.length > 0 ? 1 : 0;
