// End-to-end pipeline tests against the bundled sample dataset. A fixed `now`
// keeps recency math deterministic regardless of when the suite runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Datastore } from '../src/datastore.js';
import { assessAircraft } from '../src/assess.js';
import { renderReport } from '../src/report.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'sample');
const NOW = new Date('2026-07-07T12:00:00Z');

const store = new Datastore(DATA_DIR);

test('high-signal aircraft (N789EF) surfaces the expected public-record findings', () => {
  const a = assessAircraft(store, 'N789EF', { now: NOW });

  assert.equal(a.identity.confidence, 'high');
  assert.ok(a.score >= 30, `expected elevated score, got ${a.score}`);

  const byKey = Object.fromEntries(a.modules.map((m) => [m.key, m]));
  assert.ok(byKey.registration.score > 0, 'registration churn + trustee should score');
  assert.equal(byKey.maintenance.detail.tailSdrCount, 2);
  assert.equal(byKey.accidents.detail.directCount, 1);
  assert.ok(byKey.adExposure.detail.applicableCount >= 2, 'spar + exhaust ADs should apply');
  assert.ok(byKey.enforcement.detail.matchCount >= 2, 'both Gulfline cases should match');
  assert.ok(
    byKey.utilisation.findings.some((f) => /repositioning/i.test(f.text)),
    'pre-sale repositioning pattern should be flagged',
  );
  assert.ok(byKey.utilisation.detail.longestGapDays >= 180);
  assert.equal(byKey.utilisation.detail.homeAirport, 'OPF');
});

test('clean aircraft (N456CD) scores in the low band', () => {
  const a = assessAircraft(store, 'N456CD', { now: NOW });
  assert.ok(a.score <= 20, `expected low band, got ${a.score}`);
  assert.equal(a.band.label, 'Low public risk signal');
  const enforcement = a.modules.find((m) => m.key === 'enforcement');
  assert.equal(enforcement.detail.matchCount, 0);
});

test('trainer (N123AB) separates model-level SDR themes from tail evidence', () => {
  const a = assessAircraft(store, 'N123AB', { now: NOW });
  const maintenance = a.modules.find((m) => m.key === 'maintenance');
  assert.equal(maintenance.detail.tailSdrCount, 0);
  assert.ok(maintenance.detail.modelThemes.length >= 2);
  assert.ok(
    maintenance.findings.some((f) => /not a defect claim against this aircraft/i.test(f.text)),
    'model-level findings must carry the tail-vs-model disclaimer',
  );
  const utilisation = a.modules.find((m) => m.key === 'utilisation');
  assert.ok(
    utilisation.findings.some((f) => /training/i.test(f.text)),
    'local-flight pattern should be flagged as training-like',
  );
});

test('scores are ordered: clean < trainer < high-signal', () => {
  const clean = assessAircraft(store, 'N456CD', { now: NOW }).score;
  const trainer = assessAircraft(store, 'N123AB', { now: NOW }).score;
  const high = assessAircraft(store, 'N789EF', { now: NOW }).score;
  assert.ok(clean < trainer && trainer < high, `${clean} < ${trainer} < ${high} expected`);
});

test('unknown and invalid N-numbers resolve gracefully', () => {
  const unknown = assessAircraft(store, 'N99999', { now: NOW });
  assert.equal(unknown.identity.confidence, 'none');
  assert.equal(unknown.score, null);
  assert.match(renderReport(unknown), /Identity could not be resolved/);

  const invalid = assessAircraft(store, 'NOTATAIL', { now: NOW });
  assert.equal(invalid.identity.registry, null);
  assert.ok(invalid.identity.issues.length > 0);
});

test('report contains all 10 sections and the disclaimer', () => {
  const md = renderReport(assessAircraft(store, 'N789EF', { now: NOW }));
  for (const section of [
    '## 1. Executive summary',
    '## 2. Aircraft identity',
    '## 3. Registration and ownership',
    '## 4. Maintenance and defect signals',
    '## 5. Airworthiness Directive exposure',
    '## 6. Accident/incident history',
    '## 7. Utilisation profile',
    '## 8. Operator/compliance context',
    '## 9. Airport/environment context',
    '## 10. Buyer checklist',
  ]) {
    assert.ok(md.includes(section), `missing ${section}`);
  }
  assert.match(md, /not a safety certification/);
  assert.match(md, /Public records show (low|moderate|high) review priority\./);
});

test('language guardrails: reports never render forbidden judgements', () => {
  for (const n of ['N123AB', 'N456CD', 'N789EF']) {
    const md = renderReport(assessAircraft(store, n, { now: NOW }));
    for (const forbidden of [
      /this aircraft is (un)?safe/i,
      /bad operator/i,
      /pilot incompetence/i,
      /training failure/i,
    ]) {
      assert.ok(!forbidden.test(md), `${n}: report matched forbidden phrase ${forbidden}`);
    }
  }
});

test('ASRS findings always carry the unverified-narrative caveat', () => {
  const a = assessAircraft(store, 'N789EF', { now: NOW });
  const hf = a.modules.find((m) => m.key === 'humanFactors');
  const themed = hf.findings.filter((f) => /Human-factors theme/.test(f.text));
  assert.ok(themed.length > 0, 'sample data should produce human-factors themes');
  for (const f of themed) {
    assert.match(f.text, /voluntary, self-reported, and not independently verified/);
  }
});
