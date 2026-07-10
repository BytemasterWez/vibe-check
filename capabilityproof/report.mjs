#!/usr/bin/env node

// Daily report: compile fleet-wide key metrics from receipts and history,
// send the digest to Telegram, and write a markdown copy to data/reports/.
//
//   node capabilityproof/report.mjs daily            build + send the digest
//   node capabilityproof/report.mjs daily --dry-run  print without sending
//   node capabilityproof/report.mjs test             send a test message
//   node capabilityproof/report.mjs setup-telegram   discover your chat id
//
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.

import fs from 'fs';
import path from 'path';
import { createService, DEFAULT_DATA_DIR } from './lib/service.mjs';
import { receiptIsFresh } from './lib/receipts.mjs';
import { sendTelegram, discoverChatId } from './lib/telegram.mjs';

const PROPOSED_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'manifests-proposed');

export function buildMetrics() {
  const service = createService();
  const rows = [];
  for (const m of service.manifests.values()) {
    const receipt = service.store.latestReceiptFor(m.capability_id);
    const stats = service.store.historyStats(m.capability_id);
    rows.push({ id: m.capability_id, category: m.category, receipt, stats });
  }

  const verified = rows.filter((r) => r.receipt?.status === 'verified');
  const failing = rows.filter((r) => r.receipt && r.receipt.status !== 'verified');
  const never = rows.filter((r) => !r.receipt);
  const stale = rows.filter((r) => r.receipt && !receiptIsFresh(r.receipt));
  const drifted = rows.filter((r) => (r.stats.schema_changes_30d || 0) > 0);
  const latencies = verified.map((r) => r.receipt.results?.latency_ms).filter((n) => n != null).sort((a, b) => a - b);
  const rates = rows.map((r) => r.stats.success_rate_30d).filter((n) => n != null);

  let quarantined = 0;
  if (fs.existsSync(PROPOSED_DIR)) {
    quarantined = fs.readdirSync(PROPOSED_DIR).filter((f) => f.endsWith('.json')).length;
  }

  return {
    generated_at: new Date().toISOString(),
    totals: {
      capabilities: rows.length,
      verified: verified.length,
      failing: failing.length,
      never_verified: never.length,
      stale_receipts: stale.length,
      quarantined,
    },
    fleet: {
      median_latency_ms: latencies.length ? latencies[Math.floor(latencies.length / 2)] : null,
      p95_latency_ms: latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : null,
      avg_success_rate_30d: rates.length ? Number((rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(3)) : null,
      sources_with_drift_30d: drifted.length,
    },
    failing: failing.map((r) => ({
      capability_id: r.id,
      status: r.receipt.status,
      since: r.receipt.verified_at,
      failures: (r.receipt.failures || []).slice(0, 3),
    })),
    drifted: drifted.map((r) => ({ capability_id: r.id, schema_changes_30d: r.stats.schema_changes_30d })),
  };
}

export function formatDigestTelegram(m) {
  const t = m.totals;
  const f = m.fleet;
  const health = t.failing === 0 ? '🟢' : t.failing <= 2 ? '🟡' : '🔴';
  const lines = [
    `${health} <b>CapabilityProof daily report</b>`,
    `${t.verified}/${t.capabilities} sources verified · ${t.quarantined} in quarantine`,
    '',
    `<b>Fleet:</b> median latency ${f.median_latency_ms ?? '—'}ms · p95 ${f.p95_latency_ms ?? '—'}ms · 30d success ${f.avg_success_rate_30d != null ? Math.round(f.avg_success_rate_30d * 100) + '%' : '—'} · drift in ${f.sources_with_drift_30d} source(s)`,
  ];
  if (m.failing.length) {
    lines.push('', '<b>Failing:</b>');
    for (const x of m.failing.slice(0, 5)) {
      lines.push(`• <code>${x.capability_id}</code> (${x.status})`);
      if (x.failures[0]) lines.push(`   ${x.failures[0].slice(0, 120)}`);
    }
  }
  if (m.drifted.length) {
    lines.push('', '<b>Schema drift (30d):</b> ' + m.drifted.map((d) => `<code>${d.capability_id}</code>`).join(', '));
  }
  if (t.stale_receipts > 0) lines.push('', `⚠️ ${t.stale_receipts} receipt(s) stale — is the sweep timer running?`);
  return lines.join('\n');
}

export function formatDigestMarkdown(m) {
  const t = m.totals;
  const f = m.fleet;
  const lines = [
    `# CapabilityProof daily report — ${m.generated_at.slice(0, 10)}`,
    '',
    `- Sources verified: **${t.verified}/${t.capabilities}** (${t.failing} failing, ${t.never_verified} never verified, ${t.stale_receipts} stale)`,
    `- Quarantine: ${t.quarantined} source(s) awaiting promotion`,
    `- Fleet: median latency ${f.median_latency_ms ?? '—'}ms, p95 ${f.p95_latency_ms ?? '—'}ms, average 30d success ${f.avg_success_rate_30d ?? '—'}, drift in ${f.sources_with_drift_30d} source(s)`,
  ];
  if (m.failing.length) {
    lines.push('', '## Failing sources', '');
    for (const x of m.failing) {
      lines.push(`- \`${x.capability_id}\` — ${x.status} since ${x.since}`);
      for (const fl of x.failures) lines.push(`  - ${fl}`);
    }
  }
  if (m.drifted.length) {
    lines.push('', '## Schema drift (30 days)', '', ...m.drifted.map((d) => `- \`${d.capability_id}\`: ${d.schema_changes_30d} change(s)`));
  }
  return lines.join('\n') + '\n';
}

async function daily(dryRun) {
  const metrics = buildMetrics();
  const md = formatDigestMarkdown(metrics);
  const reportsDir = path.join(DEFAULT_DATA_DIR, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const file = path.join(reportsDir, `report-${metrics.generated_at.slice(0, 10)}.md`);
  fs.writeFileSync(file, md);
  console.log(md);
  console.log(`(written to ${path.relative(process.cwd(), file)})`);

  if (dryRun) return;
  const result = await sendTelegram(formatDigestTelegram(metrics));
  console.log(result.sent ? 'Telegram digest sent.' : `Telegram not sent: ${result.reason}`);
}

async function test() {
  const result = await sendTelegram('✅ <b>CapabilityProof</b> — Telegram alerts are working. You will get issue alerts as they happen and a daily report.');
  console.log(result.sent ? 'Test message sent — check Telegram.' : `Failed: ${result.reason}`);
  if (!result.sent) process.exitCode = 1;
}

async function setupTelegram() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log(`No TELEGRAM_BOT_TOKEN set. One-time setup:
  1. In Telegram, message @BotFather, send /newbot, follow the prompts.
  2. Copy the token it gives you and set it:  export TELEGRAM_BOT_TOKEN="123456:ABC..."
  3. Open your new bot in Telegram and send it any message (e.g. "hi").
  4. Run this command again to discover your chat id.`);
    process.exitCode = 1;
    return;
  }
  const chats = await discoverChatId();
  if (chats.length === 0) {
    console.log('No messages found yet. Open your bot in Telegram, send it any message, then run this again.');
    process.exitCode = 1;
    return;
  }
  console.log('Found chat(s):');
  for (const c of chats) console.log(`  chat_id=${c.chat_id}  ${c.name}`);
  console.log(`\nSet:  export TELEGRAM_CHAT_ID="${chats[0].chat_id}"\nThen: node capabilityproof/report.mjs test`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [command, ...rest] = process.argv.slice(2);
  const commands = {
    daily: () => daily(rest.includes('--dry-run')),
    test,
    'setup-telegram': setupTelegram,
  };
  const run = commands[command || 'daily'];
  if (!run) {
    console.error('Commands: daily [--dry-run] | test | setup-telegram');
    process.exitCode = 2;
  } else {
    await run();
  }
}
