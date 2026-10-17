// Ingestion infrastructure: artifact store (hashing/duplicates), table store
// (staging → promote, schema-change detection), health log.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore, sha256 } from '../src/ingest/artifactStore.js';
import { TableStore } from '../src/ingest/tableStore.js';
import { HealthLog, healthRecord, STATUS, statusForFetchError } from '../src/ingest/health.js';

function tmp() {
  return mkdtempSync(join(tmpdir(), 'aerorisk-ingest-'));
}

test('artifact store hashes, stores metadata, and detects duplicate content', () => {
  const store = new ArtifactStore(tmp(), { now: new Date('2026-07-07T12:00:00Z') });
  const first = store.save('faa_sdr', 'sdr_2024.csv', Buffer.from('A,B\n1,2\n'), { sourceUrl: 'u' });
  assert.equal(first.duplicate, false);
  assert.equal(first.hash, sha256(Buffer.from('A,B\n1,2\n')));
  assert.ok(existsSync(`${first.path}.meta.json`));
  assert.equal(JSON.parse(readFileSync(`${first.path}.meta.json`, 'utf8')).sourceUrl, 'u');

  const dup = store.save('faa_sdr', 'sdr_2024.csv', Buffer.from('A,B\n1,2\n'));
  assert.equal(dup.duplicate, true);

  // Changed content on the same day replaces that day's file (immutability
  // holds across days, not within one).
  const changed = store.save('faa_sdr', 'sdr_2024.csv', Buffer.from('A,B\n1,3\n'));
  assert.equal(changed.duplicate, false);
  assert.equal(store.list('faa_sdr').length, 1);
  assert.equal(store.latest('faa_sdr', 'sdr_2024.csv').meta.sha256, changed.hash);
});

test('table store: staging is invisible until promote', () => {
  const store = new TableStore(tmp());
  store.writeStaging('src', 'registry', ['A', 'B'], [{ A: '1', B: 'x,y' }]);
  assert.equal(store.readProduction('registry'), null);
  const promoted = store.promote('src');
  assert.deepEqual(promoted, ['registry.csv']);
  assert.deepEqual(store.readProduction('registry'), [{ A: '1', B: 'x,y' }]);
});

test('table store detects schema changes against saved fingerprints', () => {
  const store = new TableStore(tmp());
  const staged1 = [store.writeStaging('src', 't', ['A', 'B'], [])];
  assert.deepEqual(store.detectSchemaChanges('src', staged1), []);
  store.saveSchemaFingerprints('src', staged1);

  const staged2 = [store.writeStaging('src', 't', ['A', 'C'], [])];
  const changes = store.detectSchemaChanges('src', staged2);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].previous, ['A', 'B']);
  assert.deepEqual(changes[0].current, ['A', 'C']);
});

test('health log appends records and renders the daily report', () => {
  const base = tmp();
  const log = new HealthLog(base, { now: new Date('2026-07-07T12:00:00Z') });
  const rec = healthRecord('faa_registry', new Date(), {
    status: STATUS.BLOCKED,
    error_message: 'HTTP 403 from gateway',
    confidence: 'none',
  });
  log.append(rec);
  assert.equal(log.all().length, 1);
  assert.equal(log.all()[0].status, 'BLOCKED');

  const path = log.writeDailyReport([rec]);
  const md = readFileSync(path, 'utf8');
  assert.match(md, /Ingestion health — 2026-07-07/);
  assert.match(md, /BLOCKED/);
  assert.match(md, /HTTP 403 from gateway/);
});

test('fetch errors map to honest statuses', () => {
  assert.equal(statusForFetchError(new Error('HTTP 403 from https://x')), STATUS.BLOCKED);
  assert.equal(statusForFetchError(new Error('HTTP 500 from https://x')), STATUS.SOURCE_UNAVAILABLE);
  assert.equal(statusForFetchError(new Error('The operation was aborted due to timeout')), STATUS.SOURCE_UNAVAILABLE);
});
