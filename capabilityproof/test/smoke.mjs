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
//   8. webhooks fire on status changes and schema drift

import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { createService } from '../lib/service.mjs';
import { verifyReceiptSignature } from '../lib/receipts.mjs';
import { verifyAttestationSignature } from '../lib/attestation.mjs';
import { runChecks } from '../lib/evaluate.mjs';
import { createLlmClient, extractJson } from '../lib/llm.mjs';
import { findRowArray, draftManifestFallback, draftManifestLlm } from '../scout.mjs';
import { validateManifest } from '../lib/manifest.mjs';
import { sendTelegram, formatEventMessage } from '../lib/telegram.mjs';
import { applyPolicy, POLICIES } from '../lib/policy.mjs';
import { spawnSync } from 'child_process';

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

// Webhook receiver: collects status-change and drift events.
const webhookEvents = [];
const hook = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    webhookEvents.push(JSON.parse(body));
    res.writeHead(204);
    res.end();
  });
});
await new Promise((resolve) => hook.listen(0, '127.0.0.1', resolve));
const webhookUrl = `http://127.0.0.1:${hook.address().port}/events`;

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

const service = createService({ manifestDir, dataDir, webhookUrl });
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

// 8. Webhooks
ok('status-change webhook fired when the liar failed', () => {
  const e = webhookEvents.find((e) => e.event === 'capability_status_changed' && e.capability_id === 'mock.liar.population');
  assert(e, 'no status-change event for liar');
  assert.strictEqual(e.to, 'failed_checks');
  assert(e.failures.length > 0);
});
ok('schema-drift webhook fired when the good source changed shape', () => {
  const e = webhookEvents.find((e) => e.event === 'capability_schema_drift' && e.capability_id === 'mock.good.population');
  assert(e, 'no drift event');
  assert.notStrictEqual(e.previous_schema_hash, e.new_schema_hash);
});

// Declared missing-value sentinels don't fail value_range, undeclared ones do
ok('value_range tolerates declared sentinels but rejects undeclared junk', () => {
  const probeLike = { ok: true, status: 200, latency_ms: 1, body: { data: [{ v: '4.2' }, { v: '-' }, { v: '3.9' }] }, body_text: '' };
  const withSentinel = runChecks(probeLike, { checks: [{ type: 'value_range', path: 'data', field: 'v', min: 0, max: 25, allow_values: ['-'] }] });
  assert.strictEqual(withSentinel.results.task_success, true, withSentinel.failures.join('; '));
  const withoutSentinel = runChecks(probeLike, { checks: [{ type: 'value_range', path: 'data', field: 'v', min: 0, max: 25 }] });
  assert.strictEqual(withoutSentinel.results.task_success, false);
});

// --- Contracts, policies, resolver, replay ------------------------------------
ok('unique_field check catches duplicated rows', () => {
  const probeDup = { ok: true, status: 200, latency_ms: 1, body: { rows: [{ id: 'a' }, { id: 'b' }, { id: 'a' }] }, body_text: '' };
  const outcome = runChecks(probeDup, { checks: [{ type: 'unique_field', path: 'rows', field: 'id' }] });
  assert.strictEqual(outcome.results.task_success, false);
  assert(outcome.failures[0].includes('duplicated'));
});

ok('receipts carry contract and runner versions', () => {
  const latest = service.store.latestReceiptFor('mock.good.population');
  assert.strictEqual(latest.contract_version, '1.0.0');
  assert.match(latest.runner_version, /^\d+\.\d+\.\d+$/);
});

ok('production policy blocks experimental (Scout-admitted) sources', () => {
  const experimentalManifest = { capability_id: 'x', scouted: { drafted_by: 'llm' } };
  const receiptLike = { status: 'verified', verified_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString(), results: { checks_passed: 5, checks_total: 5 } };
  const strict = applyPolicy({ manifest: experimentalManifest, receipt: receiptLike, stats: { success_rate_30d: 1 }, streak: 10 }, POLICIES.production);
  assert.strictEqual(strict.allowed, false);
  assert(strict.reasons.some((r) => r.includes('experimental')));
  const loose = applyPolicy({ manifest: experimentalManifest, receipt: receiptLike, stats: { success_rate_30d: 1 }, streak: 10 }, POLICIES.permissive);
  assert.strictEqual(loose.allowed, true);
  const approvedManifest = { ...experimentalManifest, approved: true };
  assert.strictEqual(applyPolicy({ manifest: approvedManifest, receipt: receiptLike, stats: { success_rate_30d: 1 }, streak: 10 }, POLICIES.production).allowed, true);
});

// Build a clean history: the earlier injected drift failure drags the 30d
// success rate to 0.8, and the production policy (correctly) rejects that.
// Nine clean probes against one failure clears the 0.9 bar.
for (let i = 0; i < 7; i++) await service.verify('mock.good.population');
const resolution = await service.resolve({ task: 'retrieve county population estimates', policy: 'production' });
ok('resolver approves the healthy source under the production policy', () => {
  assert.strictEqual(resolution.decision, 'approved', JSON.stringify(resolution.candidates ?? resolution));
  assert.strictEqual(resolution.capability_id, 'mock.good.population');
  assert(resolution.confidence > 0.8);
  assert(resolution.receipt_id.startsWith('cpr_'));
  assert.strictEqual(resolution.policy.name, 'production');
});
ok('resolver rejections are explained per candidate', async () => {
  const rejected = await service.resolve({ capability_id: 'mock.liar.population', policy: 'production' });
  assert.strictEqual(rejected.decision, 'rejected');
  assert(rejected.candidates.every((c) => c.blocked_by.length > 0));
});

const raf = await service.resolveAndFetch({
  task: 'retrieve county population estimates',
  policy: 'production',
  declared: { tool_call: { name: 'get_county_population', arguments: {} } },
});
ok('resolve-and-fetch returns live data with the receipt attached', () => {
  assert.strictEqual(raf.resolution.decision, 'approved');
  assert.strictEqual(raf.fetch.http_status, 200);
  assert(Array.isArray(raf.fetch.data) && raf.fetch.data.length > 50);
});
ok('the call earns a signed, in-envelope attestation with the result re-validated', () => {
  const a = raf.attestation;
  assert(a && a.attestation_id.startsWith('cpa_'), 'no attestation issued');
  assert.strictEqual(a.verdict, 'conformant', JSON.stringify(a.violations));
  assert.strictEqual(a.conformance.host_locked.ok, true);
  assert.strictEqual(a.conformance.param_scope.ok, true);
  assert.strictEqual(a.conformance.result_valid.ok, true);
  assert.deepStrictEqual(a.declared, { tool_call: { name: 'get_county_population', arguments: {} } });
  const sig = service.getAttestation(a.attestation_id);
  assert.strictEqual(sig.signature_check.valid, true, 'attestation signature invalid');
});

const attReplay = await service.replayAttestation(raf.attestation.attestation_id);
ok('attestations replay: evidence is hash-bound and the call reproduces', () => {
  assert.strictEqual(attReplay.evidence_integrity, true, 'attestation evidence hash mismatch');
  assert.strictEqual(attReplay.outcomes_match, true, JSON.stringify(attReplay.differences));
  assert.strictEqual(attReplay.replay_result_valid, true);
});

// An agent supplying a param the manifest never declared as a placeholder is
// out of envelope: the request stepped outside what was approved, even though
// the source itself is healthy.
const outOfEnvelope = await service.resolveAndFetch({
  capability_id: 'mock.good.population',
  policy: 'production',
  params: { admin_override: 'true' },
});
ok('an undeclared param is caught as out_of_envelope, not silently dropped', () => {
  const a = outOfEnvelope.attestation;
  assert.strictEqual(a.verdict, 'out_of_envelope', JSON.stringify(a));
  assert.strictEqual(a.conformance.param_scope.ok, false);
  assert(a.violations.some((v) => v.check === 'param_scope'));
  // The fetch still succeeded — the point is the record flags the overreach.
  assert.strictEqual(outOfEnvelope.fetch.http_status, 200);
});

// Tamper-evidence: mutating a stored attestation breaks its signature.
ok('attestations are tamper-evident (mutation breaks the signature)', () => {
  const { attestation } = service.getAttestation(raf.attestation.attestation_id);
  const forged = { ...attestation, verdict: 'conformant', capability_id: 'mock.liar.population' };
  const check = verifyAttestationSignature(forged, service.publicKey);
  assert.strictEqual(check.valid, false);
});

const replayed = await service.replay(resolution.receipt_id);
ok('receipts replay: evidence is hash-bound and outcomes reproduce', () => {
  assert.strictEqual(replayed.evidence_integrity, true, 'evidence hash mismatch');
  assert.strictEqual(replayed.outcomes_match, true, JSON.stringify(replayed.differences));
  assert.strictEqual(replayed.replay_result, 'verified');
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

// --- Scout: drafting, row detection, and the LM Studio (OpenAI-compatible) path
const probeLike = {
  ok: true,
  status: 200,
  latency_ms: 40,
  body: { meta: { n: 2 }, items: [{ id: 'a1', name: 'First', optional_note: 'x' }, { id: 'a2', name: 'Second' }] },
  body_text: JSON.stringify({ meta: { n: 2 }, items: [{ id: 'a1', name: 'First', optional_note: 'x' }, { id: 'a2', name: 'Second' }] }),
};
const candidateLike = { name: 'Mock Directory', slug: 'mockdir.items', category: 'reference', probe_url: `${base}/unused`, notes: 'Returns mock items' };

ok('scout finds the row array in a nested response', () => {
  const found = findRowArray(probeLike.body);
  assert.strictEqual(found.path, 'items');
  assert.strictEqual(found.size, 2);
});
ok('fallback draft requires only fields present in every row', () => {
  const draft = draftManifestFallback(candidateLike, probeLike);
  assert.strictEqual(validateManifest(draft).valid, true);
  const fp = draft.test_pack.checks.find((c) => c.type === 'fields_present');
  assert.deepStrictEqual(fp.fields.sort(), ['id', 'name'], 'optional_note must not be required');
});
ok('extractJson tolerates prose and code fences around the object', () => {
  const parsed = extractJson('Sure! Here is the manifest:\n```json\n{"claim": "test", "nested": {"a": [1, 2]}}\n```\nHope that helps.');
  assert.strictEqual(parsed.claim, 'test');
});

// Fake LM Studio: OpenAI-compatible /models + /chat/completions.
const llmMock = http.createServer((req, res) => {
  if (req.url.endsWith('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ data: [{ id: 'gemma-12b-mock' }] }));
  }
  if (req.url.endsWith('/chat/completions')) {
    const draft = {
      claim: 'Returns mock directory items with stable ids, no authentication required',
      publisher: { name: 'Mock Directory', authority_url: 'https://example.test' },
      tags: ['mock', 'directory'],
      tasks: ['list mock items'],
      coverage: { countries: ['global'], granularity: 'item', temporal: 'static' },
      join_keys: ['id'],
      update_frequency: 'static',
      license: 'unknown',
      usage_notes: 'Test fixture.',
      checks: [
        { type: 'status', equals: 200 },
        { type: 'json' },
        { type: 'min_rows', path: 'items', min: 1 },
        { type: 'field_pattern', path: 'items', field: 'id', pattern: '^a[0-9]+$' },
        { type: 'not_a_real_check', foo: 'must be filtered out' },
      ],
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ choices: [{ message: { content: 'Here you go:\n```json\n' + JSON.stringify(draft) + '\n```' } }] }));
  }
  res.writeHead(404);
  res.end();
});
await new Promise((resolve) => llmMock.listen(0, '127.0.0.1', resolve));
const llm = createLlmClient({ baseUrl: `http://127.0.0.1:${llmMock.address().port}/v1` });

await (async () => {
  const upOk = await llm.available();
  ok('scout detects a running OpenAI-compatible model server', () => assert.strictEqual(upOk, true));
  const draft = await draftManifestLlm(llm, candidateLike, probeLike);
  ok('LLM-drafted manifest is valid and normalised', () => {
    assert.strictEqual(validateManifest(draft).valid, true);
    assert.strictEqual(draft.capability_id, 'source.mockdir.items');
    assert.strictEqual(draft.risk_class, 'read_only');
    assert.strictEqual(draft.test_pack.request.url, candidateLike.probe_url, 'model must not control the probe URL');
  });
  ok('invalid check types from the model are filtered out', () => {
    assert(!draft.test_pack.checks.some((c) => c.type === 'not_a_real_check'));
    assert(draft.test_pack.checks.some((c) => c.type === 'field_pattern'));
  });
  ok('LLM-drafted checks pass against the sampled response', () => {
    const outcome = runChecks(probeLike, draft.test_pack);
    assert.strictEqual(outcome.results.task_success, true, outcome.failures.join('; '));
  });
})();
llmMock.close();

// --- Telegram transport (against a mock Bot API) and doctor -------------------
const tgCalls = [];
const tgMock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    tgCalls.push({ url: req.url, body: body ? JSON.parse(body) : null });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
});
await new Promise((resolve) => tgMock.listen(0, '127.0.0.1', resolve));
const tgEnv = {
  TELEGRAM_BOT_TOKEN: 'test-token',
  TELEGRAM_CHAT_ID: '12345',
  TELEGRAM_API_URL: `http://127.0.0.1:${tgMock.address().port}`,
};

await (async () => {
  const result = await sendTelegram('hello from smoke test', { env: tgEnv });
  ok('telegram messages are delivered to the Bot API', () => {
    assert.strictEqual(result.sent, true, result.reason);
    assert.strictEqual(tgCalls[0].url, '/bottest-token/sendMessage');
    assert.strictEqual(tgCalls[0].body.chat_id, '12345');
  });
})();
ok('alert formatting names the capability and the evidence', () => {
  const msg = formatEventMessage({
    event: 'capability_status_changed',
    capability_id: 'source.mock.thing',
    from: 'verified',
    to: 'failed_checks',
    failures: ['min_rows [completeness]: 1 rows (minimum 50)'],
    fallback_capability_ids: ['source.mock.other'],
  });
  assert(msg.includes('source.mock.thing') && msg.includes('min_rows') && msg.includes('source.mock.other'));
});
ok('telegram send failure is reported, not thrown', async () => {
  const result = await sendTelegram('x', { env: { ...tgEnv, TELEGRAM_API_URL: 'http://127.0.0.1:1' } });
  assert.strictEqual(result.sent, false);
});
tgMock.close();

// Doctor runs end to end in dry-run mode and reports each check
const doctor = spawnSync('node', [new URL('../doctor.mjs', import.meta.url).pathname, '--dry-run'], { encoding: 'utf-8', timeout: 60000 });
ok('doctor performs its checks and summarises', () => {
  const out = doctor.stdout + doctor.stderr;
  assert(out.includes('manifests'), 'manifest check missing');
  assert(out.includes('signing_keys'), 'keys check missing');
  assert(out.includes('doctor:'), 'summary missing');
});

mock.close();
hook.close();
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} assertions passed${process.exitCode ? ' (with failures)' : ''}`);
