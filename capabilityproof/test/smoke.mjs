#!/usr/bin/env node

// CapabilityProof smoke test. No network access required: spins up local mock
// sources, then proves the pipeline end to end:
//
//   1. a healthy source earns a signed "verified" receipt
//   2. a lying source (HTTP 200, wrong content) is caught by semantic checks
//   3. an unreachable source produces an "unreachable" receipt
//   4. receipts are tamper-evident (signature breaks on mutation)
//   5. search ranks verified sources first; route picks the healthy one and
//      falls back away from the liar
//   6. schema drift between probes is counted in history stats
//   7. cached verification honours receipt TTL

import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { createService } from '../lib/service.mjs';
import { verifyReceiptSignature } from '../lib/receipts.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capabilityproof-test-'));
const manifestDir = path.join(tmp, 'manifests');
const dataDir = path.join(tmp, 'data');
fs.mkdirSync(manifestDir, { recursive: true });

// --- Mock upstream sources -------------------------------------------------
let driftMode = false;
const mock = http.createServer((req, res) => {
  if (req.url.startsWith('/good/population')) {
    const rows = [['NAME', 'POP', 'state', 'county']];
    for (let i = 1; i <= 60; i++) {
      rows.push([`County ${i}`, String(1000 * i), '22', String(i).padStart(3, '0')]);
    }
    const body = driftMode
      ? JSON.stringify({ data: rows, note: 'v2 envelope' }) // changed shape => drift
      : JSON.stringify(rows);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(body);
  }
  if (req.url.startsWith('/liar/population')) {
    // The classic failure: HTTP 200, but an HTML error page instead of data.
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end('<html><head><title>Missing Key</title></head><body>Please supply a key.</body></html>');
  }
  if (req.url.startsWith('/stale/population')) {
    // Valid JSON but truncated (incomplete dataset) and bad join keys.
    const rows = [['NAME', 'POP', 'state', 'county'], ['Only County', '123', 'LA', 'one']];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(rows));
  }
  res.writeHead(404);
  res.end('not found');
});

await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${mock.address().port}`;

// --- Test manifests ----------------------------------------------------------
const commonChecks = [
  { type: 'status', equals: 200 },
  { type: 'json' },
  { type: 'min_rows', path: '', transform: 'array_table', min: 50 },
  { type: 'fields_present', path: '', transform: 'array_table', fields: ['NAME', 'POP', 'state', 'county'] },
  { type: 'field_pattern', path: '', transform: 'array_table', field: 'state', pattern: '^[0-9]{2}$' },
  { type: 'value_range', path: '', transform: 'array_table', field: 'POP', min: 0, max: 10000000 },
];

function writeManifest(id, urlPath, extra = {}) {
  const m = {
    capability_id: id,
    claim: `Returns county population data (${id})`,
    publisher: { name: 'Mock Publisher' },
    protocol: 'rest',
    category: 'demographics',
    tags: ['population', 'county', 'fips'],
    tasks: ['retrieve county population estimates'],
    coverage: { countries: ['US'] },
    join_keys: ['state_fips', 'county_fips'],
    auth: { type: 'none', paid: false },
    cost: { per_call_usd: 0 },
    risk_class: 'read_only',
    receipt_ttl_hours: 6,
    test_pack: { id: `${id}.test_v1`, request: { method: 'GET', url: `${base}${urlPath}` }, checks: commonChecks },
    fallback_capability_ids: [],
    ...extra,
  };
  fs.writeFileSync(path.join(manifestDir, `${id}.json`), JSON.stringify(m, null, 2));
}

writeManifest('mock.good.population', '/good/population', { fallback_capability_ids: ['mock.liar.population'] });
writeManifest('mock.liar.population', '/liar/population');
writeManifest('mock.stale.population', '/stale/population');
writeManifest('mock.dead.population', '/population', {
  test_pack: {
    id: 'mock.dead.test_v1',
    request: { method: 'GET', url: 'http://127.0.0.1:1/population' }, // nothing listens here
    checks: commonChecks,
  },
});

const service = createService({ manifestDir, dataDir });
let passed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('capabilityproof smoke test\n');

// 1. Healthy source -> verified, signed receipt
const good = (await service.verify('mock.good.population')).receipt;
ok('healthy source is verified', () => assert.strictEqual(good.status, 'verified'));
ok('receipt has evidence hash and signature', () => {
  assert.match(good.evidence_hash, /^sha256:/);
  assert.match(good.signature, /^ed25519:/);
});
ok('receipt signature validates', () => {
  assert.strictEqual(verifyReceiptSignature(good, service.publicKey).valid, true);
});
ok('receipt expires in the future', () => assert(Date.parse(good.expires_at) > Date.now()));

// 2. Lying 200 -> failed_checks with the JSON check naming the HTML page
const liar = (await service.verify('mock.liar.population')).receipt;
ok('HTTP-200 HTML error page is caught', () => {
  assert.strictEqual(liar.status, 'failed_checks');
  assert(liar.failures.some((f) => f.includes('not valid JSON')), `failures: ${liar.failures}`);
});

// 2b. Truncated dataset + bad join keys -> failed_checks with specific evidence
const stale = (await service.verify('mock.stale.population')).receipt;
ok('truncated dataset fails min_rows', () => {
  assert.strictEqual(stale.status, 'failed_checks');
  assert(stale.failures.some((f) => f.startsWith('min_rows')), `failures: ${stale.failures}`);
});
ok('bad join keys fail field_pattern', () => {
  assert(stale.failures.some((f) => f.startsWith('field_pattern')), `failures: ${stale.failures}`);
});

// 3. Unreachable source
const dead = (await service.verify('mock.dead.population')).receipt;
ok('unreachable source is marked unreachable', () => assert.strictEqual(dead.status, 'unreachable'));

// 4. Tamper evidence
ok('tampered receipt fails signature check', () => {
  const forged = { ...good, results: { ...good.results, task_success: true, completeness_score: 1 }, claim: 'Returns EVERYTHING' };
  assert.strictEqual(verifyReceiptSignature(forged, service.publicKey).valid, false);
});

// 5. Search + route
const results = service.search({ task: 'retrieve county population estimates', constraints: { country: 'US', join_keys: ['state_fips', 'county_fips'] } });
ok('search returns all mock sources', () => assert(results.length >= 4));
ok('search ranks the verified source first', () => assert.strictEqual(results[0].capability_id, 'mock.good.population'));

const routed = await service.route({ task: 'retrieve county population estimates', verify_mode: 'cached' });
ok('route picks the healthy source', () => {
  assert.strictEqual(routed.routed, true);
  assert.strictEqual(routed.capability_id, 'mock.good.population');
});
ok('route includes calling instructions and fallbacks', () => {
  assert(routed.instructions.request.url.includes('/good/population'));
  assert(Array.isArray(routed.fallback_capability_ids));
});

// explain_failure names the evidence
const explanation = service.explainFailure('mock.liar.population');
ok('explain_failure cites the failing checks', () => {
  assert(explanation.failures.some((f) => f.includes('not valid JSON')));
});

// 6. Schema drift detection
driftMode = true;
await service.verify('mock.good.population');
const statsAfterDrift = service.store.historyStats('mock.good.population');
ok('schema drift between probes is counted', () => assert.strictEqual(statsAfterDrift.schema_changes_30d, 1));
driftMode = false;

// 7. Receipt caching honours TTL
const first = await service.verify('mock.good.population', { forceLiveProbe: true });
const cachedRun = await service.verify('mock.good.population', { forceLiveProbe: false });
ok('fresh receipt is served from cache when live probe not forced', () => {
  assert.strictEqual(cachedRun.cached, true);
  assert.strictEqual(cachedRun.receipt.receipt_id, first.receipt.receipt_id);
});

// Receipt retrieval round-trip
const fetched = service.getReceipt(good.receipt_id);
ok('receipt retrieval round-trips with valid signature', () => {
  assert.strictEqual(fetched.receipt.receipt_id, good.receipt_id);
  assert.strictEqual(fetched.signature_check.valid, true);
});
const evidence = service.getEvidence(good.receipt_id);
ok('evidence sample is stored and hash-bound', () => {
  assert.strictEqual(evidence.capability_id, 'mock.good.population');
  assert(typeof evidence.body_sample === 'string' && evidence.body_sample.length > 0);
});

mock.close();
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} assertions passed${process.exitCode ? ' (with failures)' : ''}`);
