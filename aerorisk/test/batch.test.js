// Batch enrichment driver: per-aircraft records, coverage accounting, V1
// gate rendering, deduplication, and unresolved-aircraft handling.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Datastore } from '../src/datastore.js';
import { runBatch, recordsCsv, renderBatchReport } from '../src/batch.js';

const SAMPLE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'sample');
const NOW = new Date('2026-07-07T12:00:00Z');
const store = new Datastore(SAMPLE);

test('batch enriches and scores every submitted aircraft', () => {
  const result = runBatch(store, ['N123AB', 'N456CD', 'N789EF'], { now: NOW });
  assert.equal(result.coverage.submitted, 3);
  assert.equal(result.coverage.resolved, 3);
  assert.equal(result.coverage.scored, 3);
  assert.equal(result.coverage.sdrAttempted, 3);
  assert.equal(result.coverage.ntsbAttempted, 3);
  assert.equal(result.coverage.adAttempted, 3);

  const byN = Object.fromEntries(result.records.map((r) => [r.N_NUMBER, r]));
  assert.equal(byN.N789EF.RESOLVED, 'yes');
  assert.ok(Number(byN.N789EF.OVERALL_REVIEW_PRIORITY) > Number(byN.N456CD.OVERALL_REVIEW_PRIORITY));
  assert.ok(Number(byN.N789EF.EVIDENCE_COUNT) > 0);
  assert.ok(Number(byN.N789EF.SDR_TAIL_SCORE) > 0);
});

test('coverage separates direct-signal aircraft from the rest', () => {
  const result = runBatch(store, ['N123AB', 'N456CD', 'N789EF'], { now: NOW });
  // N789EF has tail SDRs + a direct NTSB event; N123AB/N456CD do not.
  assert.equal(result.coverage.withDirectSignal, 1);
});

test('unknown N-numbers are recorded as unresolved, not dropped', () => {
  const result = runBatch(store, ['N789EF', 'N00000'], { now: NOW });
  assert.equal(result.coverage.submitted, 2);
  assert.equal(result.coverage.resolved, 1);
  const unresolved = result.records.find((r) => r.N_NUMBER === 'N00000');
  assert.equal(unresolved.RESOLVED, 'no');
  assert.equal(unresolved.OVERALL_REVIEW_PRIORITY, '');
});

test('duplicate and unnormalised inputs are deduplicated', () => {
  const result = runBatch(store, ['n789ef', 'N789EF', 'N-789-EF'], { now: NOW });
  assert.equal(result.coverage.submitted, 1);
});

test('records CSV has a header row plus one row per submitted aircraft', () => {
  const result = runBatch(store, ['N123AB', 'N456CD'], { now: NOW });
  const lines = recordsCsv(result).trim().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^N_NUMBER,RESOLVED,IDENTITY_CONFIDENCE/);
});

test('V1 gate reports PASS when all resolve, INCOMPLETE otherwise', () => {
  const pass = renderBatchReport(runBatch(store, ['N123AB', 'N789EF'], { now: NOW }), { now: NOW });
  assert.match(pass, /\*\*V1 gate:\*\* PASS/);
  assert.match(pass, /Highest review priority/);

  const incomplete = renderBatchReport(runBatch(store, ['N789EF', 'N00000'], { now: NOW }), { now: NOW });
  assert.match(incomplete, /\*\*V1 gate:\*\* INCOMPLETE/);
  assert.match(incomplete, /## Unresolved/);
  assert.match(incomplete, /- N00000/);
});
