#!/usr/bin/env node
// Concierge carrier-report generator (TEST tool, not a platform).
// Usage: node generate.mjs <USDOT> [<USDOT> ...] [--out <dir>] [--json]
// Node's fetch needs the proxy flag in restricted envs; re-exec with it set.
import { spawnSync } from 'node:child_process';
if (!process.env.NODE_USE_ENV_PROXY && (process.env.HTTPS_PROXY || process.env.https_proxy)) {
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1', NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --disable-warning=UNDICI-EHPA`.trim() },
  });
  process.exit(r.status ?? 1);
}

const { writeFileSync, mkdirSync } = await import('node:fs');
const { join } = await import('node:path');
const { fetchCarrier } = await import('./fmcsa.mjs');
const { assessCarrier } = await import('./assess.mjs');
const { renderCarrierReport } = await import('./report.mjs');

const argv = process.argv.slice(2);
const dots = argv.filter((a) => /^\d+$/.test(a));
const outDir = (argv[argv.indexOf('--out') + 1] && !argv.includes('--out') ? null : argv[argv.indexOf('--out') + 1]) || process.cwd();
const asJson = argv.includes('--json');

if (dots.length === 0) {
  console.error('Usage: node generate.mjs <USDOT> [<USDOT> ...] [--out <dir>] [--json]');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
for (const dot of dots) {
  try {
    const data = await fetchCarrier(dot);
    const assessment = assessCarrier(data);
    if (asJson) {
      console.log(JSON.stringify({ dot, decision: assessment.decision, indicator: assessment.indicator, census: data.census && { legal_name: data.census.legal_name, status: data.census.status_code, power_units: data.census.power_units }, crashes: data.crashes, inspections: data.inspections, flags: assessment.flags }, null, 2));
    }
    const html = renderCarrierReport(data, assessment);
    const path = join(outDir, `carrier-${dot}.html`);
    writeFileSync(path, html);
    console.log(`${dot}: ${assessment.decision}${assessment.indicator != null ? ` (indicator ${assessment.indicator}/100)` : ''} — ${data.census?.legal_name ?? 'no census record'} -> ${path}`);
  } catch (err) {
    console.error(`${dot}: FAILED — ${err.message}`);
  }
}
