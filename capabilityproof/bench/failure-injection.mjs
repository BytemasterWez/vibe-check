#!/usr/bin/env node

// Failure-injection benchmark.
//
// Spins up a mock upstream that serves ten distinct realistic failure modes
// plus two healthy controls, verifies all of them through the full pipeline,
// and scores the system:
//
//   detection rate         — injected failures that produced a failing receipt
//   false-positive rate    — healthy controls wrongly failed
//   correct classification — the failing check's dimension matches the fault
//
// This is the evidence that the evaluator catches what uptime monitoring
// misses. Runs fully offline; exits non-zero if any metric misses its target
// (detection 100%, false positives 0%).

import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createService } from '../lib/service.mjs';

// Reference dataset the healthy source serves: 20 "counties".
const REFERENCE = Array.from({ length: 20 }, (_, i) => ({
  geoid: `22${String(i + 1).padStart(3, '0')}`,
  name: `Parish ${i + 1}`,
  population: 10000 + i * 137,
  vintage: '2025',
  updated_at: new Date().toISOString(),
}));

const CASES = [
  { id: 'control_healthy', inject: 'none', expect: 'verified' },
  { id: 'control_extra_optional_fields', inject: 'extra_fields', expect: 'verified' },
  { id: 'html_200', inject: 'html_200', expect: 'failed_checks', dimension: 'availability' },
  { id: 'truncated_20pct', inject: 'truncated', expect: 'failed_checks', dimension: 'completeness' },
  { id: 'stale_timestamps', inject: 'stale', expect: 'failed_checks', dimension: 'freshness' },
  { id: 'renamed_field', inject: 'renamed_field', expect: 'failed_checks', dimension: 'schema' },
  { id: 'duplicated_rows', inject: 'duplicates', expect: 'failed_checks', dimension: 'completeness' },
  { id: 'impossible_values', inject: 'impossible_values', expect: 'failed_checks', dimension: 'schema' },
  { id: 'rate_limit_as_200', inject: 'rate_limit_200', expect: 'failed_checks', dimension: 'completeness' },
  { id: 'partial_geography', inject: 'partial_geo', expect: 'failed_checks', dimension: 'completeness' },
  { id: 'wrong_vintage', inject: 'wrong_vintage', expect: 'failed_checks', dimension: 'task' },
  { id: 'bad_join_keys', inject: 'bad_keys', expect: 'failed_checks', dimension: 'join_keys' },
];

function serveCase(inject) {
  let rows = structuredClone(REFERENCE);
  switch (inject) {
    case 'none':
      break;
    case 'extra_fields':
      rows = rows.map((r) => ({ ...r, extra_note: 'harmless', another_optional: 42 }));
      break;
    case 'html_200':
      return { contentType: 'text/html', body: '<html><head><title>Maintenance</title></head><body>Back soon</body></html>' };
    case 'truncated':
      rows = rows.slice(0, 15); // 25% of records missing
      break;
    case 'stale':
      rows = rows.map((r) => ({ ...r, updated_at: '2024-01-01T00:00:00Z' }));
      break;
    case 'renamed_field':
      rows = rows.map(({ population, ...r }) => ({ ...r, population_total: population }));
      break;
    case 'duplicates':
      rows = rows.concat(rows.slice(0, 5));
      break;
    case 'impossible_values':
      rows = rows.map((r, i) => (i % 4 === 0 ? { ...r, population: -5000 } : r));
      break;
    case 'rate_limit_200':
      return { contentType: 'application/json', body: JSON.stringify({ message: 'rate limit exceeded, retry later', rows: [] }) };
    case 'partial_geo':
      rows = rows.filter((r) => Number(r.geoid.slice(2)) <= 10);
      break;
    case 'wrong_vintage':
      rows = rows.map((r) => ({ ...r, vintage: '2019' }));
      break;
    case 'bad_keys':
      rows = rows.map((r, i) => ({ ...r, geoid: `bad-${i}` }));
      break;
    default:
      throw new Error(`unknown injection: ${inject}`);
  }
  return { contentType: 'application/json', body: JSON.stringify({ rows }) };
}

// One shared contract, mirroring what a real county-population contract
// asserts: coverage, schema, keys, plausibility, freshness, vintage.
function makeManifest(kase, base) {
  return {
    capability_id: `bench.${kase.id}`,
    claim: `Benchmark case ${kase.id}`,
    publisher: { name: 'Failure Injection Bench' },
    protocol: 'rest',
    category: 'benchmark',
    tags: ['benchmark'],
    tasks: ['benchmark county population'],
    coverage: { countries: ['US'] },
    join_keys: ['geoid'],
    auth: { type: 'none', paid: false },
    cost: { per_call_usd: 0 },
    risk_class: 'read_only',
    receipt_ttl_hours: 1,
    test_pack: {
      id: `bench_${kase.id}_v1`,
      contract_version: '1.0.0',
      request: { method: 'GET', url: `${base}/${kase.id}` },
      checks: [
        { type: 'status', equals: 200 },
        { type: 'json' },
        { type: 'min_rows', path: 'rows', min: 20 },
        { type: 'unique_field', path: 'rows', field: 'geoid' },
        { type: 'fields_present', path: 'rows', fields: ['geoid', 'name', 'population', 'vintage'] },
        { type: 'field_pattern', path: 'rows', field: 'geoid', pattern: '^[0-9]{5}$' },
        { type: 'value_range', path: 'rows', field: 'population', min: 0, max: 100000000 },
        { type: 'known_answer', path: 'rows.0.vintage', equals: '2025' },
        { type: 'freshness', path: 'rows.0.updated_at', max_age_hours: 48 },
      ],
    },
    fallback_capability_ids: [],
  };
}

// --- Run -----------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capabilityproof-bench-'));
const manifestDir = path.join(tmp, 'manifests');
fs.mkdirSync(manifestDir);

const server = http.createServer((req, res) => {
  const kase = CASES.find((c) => req.url === `/${c.id}`);
  if (!kase) { res.writeHead(404); return res.end(); }
  const { contentType, body } = serveCase(kase.inject);
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(body);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

for (const kase of CASES) {
  fs.writeFileSync(path.join(manifestDir, `${kase.id}.json`), JSON.stringify(makeManifest(kase, base), null, 2));
}

const service = createService({ manifestDir, dataDir: path.join(tmp, 'data') });
const rows = [];
for (const kase of CASES) {
  const { receipt } = await service.verify(`bench.${kase.id}`);
  const failedDimensions = new Set((receipt.failures || []).map((f) => f.match(/\[(\w+)\]/)?.[1]).filter(Boolean));
  const detected = receipt.status !== 'verified';
  const shouldDetect = kase.expect !== 'verified';
  rows.push({
    case: kase.id,
    expected: kase.expect,
    actual: receipt.status,
    outcome_correct: shouldDetect ? detected : !detected,
    dimension_expected: kase.dimension || null,
    dimension_flagged: kase.dimension ? failedDimensions.has(kase.dimension) : null,
    failing_checks: receipt.failures?.length || 0,
  });
}
server.close();
fs.rmSync(tmp, { recursive: true, force: true });

// --- Scorecard -------------------------------------------------------------------
const injected = rows.filter((r) => r.expected !== 'verified');
const controls = rows.filter((r) => r.expected === 'verified');
const detectionRate = injected.filter((r) => r.outcome_correct).length / injected.length;
const falsePositives = controls.filter((r) => !r.outcome_correct).length;
const classified = injected.filter((r) => r.dimension_flagged).length;

console.log('failure-injection benchmark\n');
for (const r of rows) {
  const mark = r.outcome_correct ? 'PASS' : 'MISS';
  const dim = r.dimension_expected ? ` dim=${r.dimension_expected}${r.dimension_flagged ? ' ✓' : ' ✗'}` : '';
  console.log(`  [${mark}] ${r.case.padEnd(30)} expected=${r.expected.padEnd(13)} actual=${r.actual}${dim}`);
}
console.log(`\n  Detection rate:          ${(detectionRate * 100).toFixed(0)}% (${injected.filter((r) => r.outcome_correct).length}/${injected.length} injected failures caught)`);
console.log(`  False positives:         ${falsePositives}/${controls.length} healthy controls wrongly failed`);
console.log(`  Correct classification:  ${classified}/${injected.length} flagged in the expected dimension`);

const pass = detectionRate === 1 && falsePositives === 0 && classified === injected.length;
console.log(`\n  ${pass ? 'BENCHMARK PASS' : 'BENCHMARK FAIL'}`);
process.exitCode = pass ? 0 : 1;
