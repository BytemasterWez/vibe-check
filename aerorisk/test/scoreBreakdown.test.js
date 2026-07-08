// Scoring V1 wiring: named score components, tail/model and direct/model
// sub-score separation, and the deregistration-history flag sourced from
// ingested bundle data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Datastore } from '../src/datastore.js';
import { assessAircraft } from '../src/assess.js';
import { buildContext, runIngestion } from '../src/ingest/runner.js';

const SAMPLE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'sample');
const NOW = new Date('2026-07-07T12:00:00Z');

const EXPECTED_COMPONENTS = [
  'identity_confidence',
  'registration_status_score',
  'deregistration_history_flag',
  'sdr_tail_score',
  'sdr_model_score',
  'ntsb_direct_event_score',
  'ntsb_model_context_score',
  'ad_exposure_score',
  'overall_review_priority',
];

test('score breakdown exposes every named V1 component', () => {
  const store = new Datastore(SAMPLE);
  const a = assessAircraft(store, 'N789EF', { now: NOW });
  assert.deepEqual(a.scoreBreakdown.map((c) => c.name), EXPECTED_COMPONENTS);
});

test('tail and model SDR scores are separated and both carry evidence', () => {
  const store = new Datastore(SAMPLE);
  const a = assessAircraft(store, 'N789EF', { now: NOW });
  const byName = Object.fromEntries(a.scoreBreakdown.map((c) => [c.name, c]));

  // N789EF has tail-specific SDRs in the sample data.
  assert.ok(byName.sdr_tail_score.value > 0, 'tail SDR score should be positive');
  assert.ok(byName.sdr_tail_score.evidence.length > 0);
  assert.ok(byName.sdr_tail_score.evidence.every((e) => /FAA SDR/.test(e)));

  // The maintenance module's own score equals tail + model (capped).
  const maintenance = a.modules.find((m) => m.key === 'maintenance');
  assert.equal(
    maintenance.score,
    Math.min(100, maintenance.detail.sdrTailScore + maintenance.detail.sdrModelScore),
  );
});

test('NTSB direct and model-context scores are separated', () => {
  const store = new Datastore(SAMPLE);
  const a = assessAircraft(store, 'N789EF', { now: NOW });
  const byName = Object.fromEntries(a.scoreBreakdown.map((c) => [c.name, c]));
  assert.ok(byName.ntsb_direct_event_score.value > 0, 'N789EF has a direct NTSB event');
  assert.ok(byName.ntsb_direct_event_score.evidence.some((e) => /NTSB/.test(e)));
});

test('deregistration flag is false without dereg history, true with it', async () => {
  // Sample dataset has no deregistration rows for N789EF → flag false.
  const store = new Datastore(SAMPLE);
  const clean = assessAircraft(store, 'N789EF', { now: NOW });
  const cleanFlag = clean.scoreBreakdown.find((c) => c.name === 'deregistration_history_flag');
  assert.equal(cleanFlag.value, false);

  // Ingest a registry bundle WITH a DEREG row for the current mark → flag true.
  const base = mkdtempSync(join(tmpdir(), 'aerorisk-dereg-'));
  const offline = mkdtempSync(join(tmpdir(), 'aerorisk-dereg-src-'));
  const reg = join(offline, 'faa_registry');
  mkdirSync(reg, { recursive: true });
  writeFileSync(join(reg, 'MASTER.txt'),
    'N-NUMBER,SERIAL NUMBER,MFR MDL CODE,ENG MFR MDL,YEAR MFR,TYPE REGISTRANT,NAME,STREET,STREET2,CITY,STATE,ZIP CODE,REGION,COUNTY,COUNTRY,LAST ACTION DATE,CERT ISSUE DATE,CERTIFICATION,TYPE AIRCRAFT,TYPE ENGINE,STATUS CODE,MODE S CODE,FRACT OWNER,AIR WORTH DATE,OTHER NAMES(1),OTHER NAMES(2),OTHER NAMES(3),OTHER NAMES(4),OTHER NAMES(5),EXPIRATION DATE,UNIQUE ID,KIT MFR,KIT MODEL,MODE S CODE HEX,\n' +
    '789EF   ,31-8152077      ,3930203,30015  ,1981,7,GULFLINE AIR CHARTER TRUSTEE,200 HARBOR WAY,,WILMINGTON,DE,19801,E,003,US,20251120,20251120,1 ,5,1 ,V ,53000731,N,20251101,,,,,,20321130,01099999,,,AB01D9  ,\n');
  writeFileSync(join(reg, 'ACFTREF.txt'),
    'CODE,MFR,MODEL,TYPE-ACFT,TYPE-ENG,AC-CAT,BUILD-CERT-IND,NO-ENG,NO-SEATS,AC-WEIGHT,SPEED,TC-DATA-SHEET,TC-DATA-HOLDER,\n' +
    '3930203,PIPER                         ,PA-31-350           ,5,1,1,0,2,010,CLASS 1,0195,A20SO,PIPER AIRCRAFT INC,\n');
  writeFileSync(join(reg, 'ENGINE.txt'),
    'CODE,MFR,MODEL,TYPE,HORSEPOWER,THRUST,\n30015  ,LYCOMING  ,TIO-540-J2BD   ,1 ,00350,000000,\n');
  writeFileSync(join(reg, 'DEREG.txt'),
    'N-NUMBER,SERIAL-NUMBER,MFR-MDL-CODE,STATUS-CODE,NAME,STREET,STREET2,CITY,STATE,ZIP-CODE,ENG-MFR-MDL,YEAR-MFR,CANCEL-DATE,MODE-S-CODE-HEX,\n' +
    '789EF   ,31-8152077      ,3930203,C ,BAYLINE AIR SERVICES INC,9 DOCK ST,,MIAMI,FL,33101,30015  ,1981,20180801,AB01D9  ,\n');

  // Single-source run: point offline directly at the bundle directory.
  const ctx = buildContext(base, { now: NOW, options: { offline: reg } });
  await runIngestion(['faa-registry'], ctx);
  const ingested = new Datastore(join(base, 'db', 'production'));
  const a = assessAircraft(ingested, 'N789EF', { now: NOW });
  const flag = a.scoreBreakdown.find((c) => c.name === 'deregistration_history_flag');
  assert.equal(flag.value, true);
  assert.ok(flag.evidence.length > 0, 'dereg flag should cite the cancellation event');
  const regMod = a.modules.find((m) => m.key === 'registration');
  assert.equal(regMod.detail.deregistrationHistoryFlag, true);
  assert.ok(regMod.findings.some((f) => /Prior deregistration/i.test(f.text)));
});

test('report renders the V1 component breakdown table', async () => {
  const { renderReport } = await import('../src/report.js');
  const store = new Datastore(SAMPLE);
  const md = renderReport(assessAircraft(store, 'N789EF', { now: NOW }));
  assert.match(md, /Score breakdown \(V1 components\)/);
  assert.match(md, /deregistration_history_flag/);
  assert.match(md, /overall_review_priority/);
});
