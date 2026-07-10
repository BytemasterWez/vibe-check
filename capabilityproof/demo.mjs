#!/usr/bin/env node

// The five-minute demo: the whole trust chain on one screen, in the exact
// sequence a prospect should see it.
//
//   node capabilityproof/demo.mjs           run straight through
//   node capabilityproof/demo.mjs --pause   wait for Enter between steps
//
// Self-contained: spins up a local mock "prospect data source" (property
// records), so it needs no network and cannot be embarrassed by a live
// outage mid-pitch. The mock is then sabotaged live — stale, truncated,
// duplicated — to show detection, rejection and fallback.

import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { createService } from './lib/service.mjs';
import { verifyReceiptSignature, receiptIsFresh } from './lib/receipts.mjs';
import { buildEvents } from './lib/notify.mjs';

const pause = process.argv.includes('--pause');

function heading(n, title) {
  console.log(`\n${'='.repeat(66)}\n  STEP ${n}: ${title}\n${'='.repeat(66)}`);
}
function say(text) {
  console.log(`  ${text}`);
}
async function waitKey() {
  if (!pause) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((r) => rl.question('  [Enter to continue] ', r));
  rl.close();
}

// --- Mock prospect source ------------------------------------------------------
const RECORDS = Array.from({ length: 25 }, (_, i) => ({
  parcel_id: `PAR-${String(i + 1).padStart(4, '0')}`,
  address: `${100 + i} Demo Street`,
  assessed_value: 150000 + i * 3500,
  updated_at: new Date().toISOString(),
}));

let sabotaged = false;
const mock = http.createServer((req, res) => {
  let records = structuredClone(RECORDS);
  if (req.url.startsWith('/backup/')) {
    // The fallback provider stays healthy throughout.
  } else if (sabotaged) {
    records = records.slice(0, 12); // truncated
    records.push(structuredClone(records[0])); // duplicated parcel id
    records.forEach((r) => (r.updated_at = '2024-06-01T00:00:00Z')); // stale
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ records }));
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${mock.address().port}`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capabilityproof-demo-'));
const manifestDir = path.join(tmp, 'manifests');
fs.mkdirSync(manifestDir);

const contract = (id, urlPath, fallbacks = []) => ({
  capability_id: id,
  manifest_version: '1.0',
  claim: 'Returns current property assessment records with unique parcel ids, complete coverage and same-day freshness',
  publisher: { name: id.includes('backup') ? 'Backup Records Provider' : 'Primary Records Provider' },
  protocol: 'rest',
  category: 'property',
  tags: ['property', 'parcel', 'assessment'],
  tasks: ['retrieve current property assessment records'],
  coverage: { countries: ['US'] },
  join_keys: ['parcel_id'],
  auth: { type: 'none', paid: false },
  cost: { per_call_usd: 0 },
  risk_class: 'read_only',
  receipt_ttl_hours: 6,
  test_pack: {
    id: `${id}.contract`,
    contract_version: '1.2.0',
    request: { method: 'GET', url: `${base}${urlPath}` },
    checks: [
      { type: 'status', equals: 200 },
      { type: 'json' },
      { type: 'min_rows', path: 'records', min: 25 },
      { type: 'unique_field', path: 'records', field: 'parcel_id' },
      { type: 'fields_present', path: 'records', fields: ['parcel_id', 'address', 'assessed_value'] },
      { type: 'value_range', path: 'records', field: 'assessed_value', min: 1000, max: 100000000 },
      { type: 'freshness', path: 'records.0.updated_at', max_age_hours: 48 },
    ],
  },
  fallback_capability_ids: fallbacks,
});

fs.writeFileSync(path.join(manifestDir, 'primary.json'), JSON.stringify(contract('demo.property_records', '/records', ['demo.property_records_backup']), null, 2));
fs.writeFileSync(path.join(manifestDir, 'backup.json'), JSON.stringify(contract('demo.property_records_backup', '/backup/records'), null, 2));

const service = createService({ manifestDir, dataDir: path.join(tmp, 'data') });

// Warm history so the strict policy has a track record to judge (narrated).
for (let i = 0; i < 3; i++) {
  await service.verify('demo.property_records');
  await service.verify('demo.property_records_backup');
}

console.log('\nCAPABILITYPROOF — the trust chain in ten steps');
say('Scenario: your product depends on an external property-records API.');
say('(Local simulation — no network needed. History pre-warmed with 3 clean daily checks.)');

heading(1, 'The capability and its verification contract');
const manifest = service.getManifest('demo.property_records');
say(`Claim: "${manifest.claim}"`);
say(`Contract v${manifest.test_pack.contract_version} asserts, mechanically:`);
for (const c of manifest.test_pack.checks) say(`  - ${c.type}${c.path !== undefined ? ` (${c.path || 'root'}${c.field ? '.' + c.field : ''})` : ''}${c.min !== undefined ? ` >= ${c.min}` : ''}${c.max_age_hours ? ` within ${c.max_age_hours}h` : ''}`);
say('"Verified" means exactly this — inspectable, versioned, nothing hidden.');
await waitKey();

heading(2, 'Live verification issues a signed receipt');
const { receipt } = await service.verify('demo.property_records');
say(`Status: ${receipt.status} — ${receipt.results.checks_passed}/${receipt.results.checks_total} checks in ${receipt.results.latency_ms}ms`);
say(`Receipt ${receipt.receipt_id}, expires ${receipt.expires_at}`);
say(`Signature: ${receipt.signature.slice(0, 28)}...  Evidence hash: ${receipt.evidence_hash.slice(0, 22)}...`);
await waitKey();

heading(3, 'Resolve under the strict "production" trust policy');
let resolution = await service.resolve({ capability_id: 'demo.property_records', policy: 'production' });
say(`Decision: ${resolution.decision.toUpperCase()} — ${resolution.capability_id} (confidence ${resolution.confidence})`);
say(`Policy requires: fresh receipt, 3+ consecutive passes, 90%+ 30-day success, no unapproved sources.`);
await waitKey();

heading(4, 'Fetch real data THROUGH the resolver');
let raf = await service.resolveAndFetch({ capability_id: 'demo.property_records', policy: 'production' });
say(`HTTP ${raf.fetch.http_status}, ${raf.fetch.data.records.length} records in ${raf.fetch.latency_ms}ms`);
say(`First record: ${JSON.stringify(raf.fetch.data.records[0])}`);
await waitKey();

heading(5, 'The receipt travels with the result');
say(`Attached receipt: ${raf.resolution.receipt_id} (valid until ${raf.resolution.receipt_valid_until})`);
const sigCheck = verifyReceiptSignature(service.getReceipt(raf.resolution.receipt_id).receipt, service.publicKey);
say(`Independent signature check: ${sigCheck.valid ? 'VALID' : 'INVALID'}`);
await waitKey();

heading(6, 'Replay: reproduce WHY it passed');
const replayed = await service.replay(raf.resolution.receipt_id);
say(`Evidence still hash-bound to receipt: ${replayed.evidence_integrity}`);
say(`Re-ran recorded contract v${replayed.contract_version} live: ${replayed.replay_result}, outcomes match: ${replayed.outcomes_match}`);
await waitKey();

heading(7, 'Now the source silently degrades (stale + truncated + duplicate)');
sabotaged = true;
say('The API still answers HTTP 200. An uptime monitor sees green.');
await waitKey();

heading(8, 'The contract catches it — with named evidence');
const { receipt: failed } = await service.verify('demo.property_records');
say(`Status: ${failed.status}`);
for (const f of failed.failures) say(`  - ${f}`);
await waitKey();

heading(9, 'The failing source loses its approval — with explicit reasons');
resolution = await service.resolve({ capability_id: 'demo.property_records', policy: 'production', max_live_probes: 0 });
const primaryVerdict = resolution.decision === 'approved'
  ? null
  : resolution.candidates.find((c) => c.capability_id === 'demo.property_records');
if (primaryVerdict) {
  say('Primary blocked by policy:');
  for (const r of primaryVerdict.blocked_by) say(`  - ${r}`);
}
const alerts = buildEvents(receipt, failed);
say(`Alert that fires to Telegram/webhooks: ${alerts[0]?.event} (${alerts[0]?.from} -> ${alerts[0]?.to})`);
await waitKey();

heading(10, 'Fallback selection — automatic, verified, explained');
raf = await service.resolveAndFetch({ task: 'retrieve current property assessment records', policy: 'production' });
say(`Decision: ${raf.resolution.decision.toUpperCase()} — routed to ${raf.resolution.capability_id}`);
say(`Fetched ${raf.fetch.data.records.length} records from the verified backup, receipt ${raf.resolution.receipt_id}`);
say(`The broken primary was skipped for stated reasons, not silently.`);

console.log(`\n${'='.repeat(66)}`);
say('That is the whole product: contract -> probe -> evidence -> signed');
say('receipt -> policy -> resolution -> fetch-with-proof -> replay.');
console.log('='.repeat(66) + '\n');

mock.close();
fs.rmSync(tmp, { recursive: true, force: true });

// Exit non-zero if the demo's own story didn't hold together (CI guard).
const ok = failed.status === 'failed_checks'
  && raf.resolution.decision === 'approved'
  && raf.resolution.capability_id === 'demo.property_records_backup'
  && replayed.evidence_integrity;
process.exitCode = ok ? 0 : 1;
if (!ok) console.error('DEMO SELF-CHECK FAILED — do not show this build to a prospect.');
