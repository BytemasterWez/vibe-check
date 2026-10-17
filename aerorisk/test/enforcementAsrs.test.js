// Enforcement and ASRS adapters: structured offline ingestion, categorisation,
// entity roll-up, theme summarisation, flexible column mapping, network/empty
// honesty, and end-to-end flow into the enforcement and human-factors modules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContext, runIngestion } from '../src/ingest/runner.js';
import { faaEnforcementAdapter, categorize, normalizeEnforcementRows } from '../src/ingest/adapters/faaEnforcement.js';
import { asrsAdapter, splitThemes, normalizeAsrsRows } from '../src/ingest/adapters/asrs.js';
import { Datastore } from '../src/datastore.js';
import { assessAircraft } from '../src/assess.js';
import { parseCsv } from '../src/csv.js';

const NOW = new Date('2026-07-07T12:00:00Z');

function newBase() {
  return mkdtempSync(join(tmpdir(), 'aerorisk-enf-'));
}
function offlineDir(name, content) {
  const dir = mkdtempSync(join(tmpdir(), 'aerorisk-off-'));
  writeFileSync(join(dir, name), content);
  return dir;
}

// --- enforcement -------------------------------------------------------------

test('enforcement categorisation keys off summary text then action', () => {
  assert.equal(categorize('Missing maintenance record entries', 'civil_penalty'), 'maintenance');
  assert.equal(categorize('Exceeded flight and duty time limitations', 'suspension'), 'operational');
  assert.equal(categorize('Random drug testing program deficiencies', 'civil_penalty'), 'drug_testing');
  assert.equal(categorize('Improper hazardous material shipment', 'civil_penalty'), 'hazmat');
  assert.equal(categorize('Unrelated summary', 'revocation'), 'certificate');
  assert.equal(categorize('Unrelated summary', 'civil_penalty'), 'other');
});

test('enforcement normalisation maps varied headers and flags recency', () => {
  const raw = parseCsv(
    'CASE_NUMBER,CLOSED_DATE,ENTITY,ENTITY_TYPE,DISPOSITION,PENALTY_AMOUNT,VIOLATION\n' +
      '2024EA1,2024-09-12,GULFLINE AIR CHARTER LLC,Part 135,civil_penalty,"$44,000",Missing maintenance records\n' +
      '2010EA9,2010-01-01,OLD OPERATOR INC,Part 135,suspension,,Duty time exceedance\n',
  );
  const { rows, missing } = normalizeEnforcementRows(raw, NOW);
  assert.deepEqual(missing, []);
  assert.equal(rows[0].RESPONDENT, 'GULFLINE AIR CHARTER LLC');
  assert.equal(rows[0].CATEGORY, 'maintenance');
  assert.equal(rows[0].RECENT, 'yes');
  assert.equal(rows[1].RECENT, 'no');
});

test('enforcement adapter without offline dir is SOURCE_UNAVAILABLE, honestly', async () => {
  const record = await faaEnforcementAdapter.run(buildContext(newBase(), { now: NOW, options: {} }));
  assert.equal(record.status, 'SOURCE_UNAVAILABLE');
  assert.match(record.error_message, /no clean bulk API/);
});

test('enforcement adapter rolls up entities and feeds the enforcement module', async () => {
  const dir = offlineDir(
    'enforcement.csv',
    'CASE_ID,DATE_CLOSED,RESPONDENT,RESPONDENT_TYPE,ACTION,AMOUNT,SUMMARY\n' +
      '2024EA110045,2024-09-12,GULFLINE AIR CHARTER LLC,Part 135 operator,civil_penalty,"$44,000",Missing maintenance record entries\n' +
      '2023EA070212,2023-05-30,GULFLINE AIR CHARTER LLC,Part 135 operator,suspension,,Exceeded flight and duty time limitations\n',
  );
  const base = newBase();
  const ctx = buildContext(base, { now: NOW, options: { offline: dir } });
  const record = await faaEnforcementAdapter.run(ctx);
  assert.match(record.status, /OK/);

  const entities = ctx.tableStore.readProduction('enforcement_entities');
  const gulfline = entities.find((e) => e.RESPONDENT === 'GULFLINE AIR CHARTER LLC');
  assert.equal(gulfline.ACTION_COUNT, '2');
  assert.equal(gulfline.CERTIFICATE_ACTIONS, '1');

  // The Datastore-compatible enforcement view drives the module.
  const store = new Datastore(join(base, 'db', 'production'));
  // Registry not ingested here; assess a registrant name match directly.
  const enf = store.enforcementForName('GULFLINE AIR CHARTER LLC');
  assert.equal(enf.length, 2);
});

// --- ASRS --------------------------------------------------------------------

test('splitThemes handles semicolon, comma, slash, and pipe delimiters', () => {
  assert.deepEqual(splitThemes('a;b'), ['a', 'b']);
  assert.deepEqual(splitThemes('a, b / c | d'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(splitThemes(''), []);
});

test('ASRS normalisation maps varied headers and re-joins themes on semicolons', () => {
  const raw = parseCsv(
    'ACCESSION_NUMBER,TIME_DATE,AIRCRAFT_MAKE,AIRCRAFT_MODEL,LOCALE_REFERENCE,CONTRIBUTING_FACTORS,REPORT_NARRATIVE\n' +
      '1954102,2024-06-19,PIPER,PA-31-350,OPF,"maintenance sign-off, dispatch pressure",Pressure to defer\n',
  );
  const { rows, missing } = normalizeAsrsRows(raw);
  assert.deepEqual(missing, []);
  assert.equal(rows[0].ACN, '1954102');
  assert.equal(rows[0].THEMES, 'maintenance sign-off;dispatch pressure');
  assert.equal(rows[0].MODEL, 'PA-31-350');
});

test('ASRS adapter is low confidence by design and summarises themes', async () => {
  const dir = offlineDir(
    'asrs.csv',
    'ACN,DATE,MFR,MODEL,AIRPORT,THEMES,SYNOPSIS\n' +
      '1954102,2024-06-19,PIPER,PA-31-350,OPF,maintenance sign-off;dispatch pressure,Defer exhaust\n' +
      '1978510,2025-01-08,PIPER,PA-31-350,OPF,fatigue;dispatch pressure,Back-to-back legs\n',
  );
  const base = newBase();
  const ctx = buildContext(base, { now: NOW, options: { offline: dir } });
  const record = await asrsAdapter.run(ctx);
  assert.match(record.status, /OK/);
  assert.equal(record.confidence, 'low', 'ASRS must stay low confidence by design');

  const themes = ctx.tableStore.readProduction('asrs_human_factor_themes');
  const dispatch = themes.find((t) => t.THEME === 'dispatch pressure');
  assert.equal(dispatch.REPORT_COUNT, '2');
});

test('ASRS empty file → ZERO_ROWS', async () => {
  const dir = offlineDir('asrs.csv', 'ACN,DATE,MFR,MODEL,AIRPORT,THEMES,SYNOPSIS\n');
  const record = await asrsAdapter.run(buildContext(newBase(), { now: NOW, options: { offline: dir } }));
  assert.equal(record.status, 'ZERO_ROWS');
});

// --- end-to-end into modules -------------------------------------------------

test('ingested enforcement + ASRS drive their report modules end to end', async () => {
  const base = newBase();
  const offline = mkdtempSync(join(tmpdir(), 'aerorisk-e2e-'));

  const reg = join(offline, 'faa_registry');
  mkdirSync(reg, { recursive: true });
  writeFileSync(join(reg, 'MASTER.txt'),
    'N-NUMBER,SERIAL NUMBER,MFR MDL CODE,ENG MFR MDL,YEAR MFR,TYPE REGISTRANT,NAME,STREET,STREET2,CITY,STATE,ZIP CODE,REGION,COUNTY,COUNTRY,LAST ACTION DATE,CERT ISSUE DATE,CERTIFICATION,TYPE AIRCRAFT,TYPE ENGINE,STATUS CODE,MODE S CODE,FRACT OWNER,AIR WORTH DATE,OTHER NAMES(1),OTHER NAMES(2),OTHER NAMES(3),OTHER NAMES(4),OTHER NAMES(5),EXPIRATION DATE,UNIQUE ID,KIT MFR,KIT MODEL,MODE S CODE HEX,\n' +
    '789EF   ,31-8152077      ,3930203,30015  ,1981,7,GULFLINE AIR CHARTER LLC,200 HARBOR WAY,,WILMINGTON,DE,19801,E,003,US,20251120,20251120,1 ,5,1 ,V ,53000731,N,20251101,,,,,,20321130,01099999,,,AB01D9  ,\n');
  writeFileSync(join(reg, 'ACFTREF.txt'),
    'CODE,MFR,MODEL,TYPE-ACFT,TYPE-ENG,AC-CAT,BUILD-CERT-IND,NO-ENG,NO-SEATS,AC-WEIGHT,SPEED,TC-DATA-SHEET,TC-DATA-HOLDER,\n' +
    '3930203,PIPER                         ,PA-31-350           ,5,1,1,0,2,010,CLASS 1,0195,A20SO,PIPER AIRCRAFT INC,\n');
  writeFileSync(join(reg, 'ENGINE.txt'),
    'CODE,MFR,MODEL,TYPE,HORSEPOWER,THRUST,\n30015  ,LYCOMING  ,TIO-540-J2BD   ,1 ,00350,000000,\n');

  const enf = join(offline, 'faa_enforcement');
  mkdirSync(enf, { recursive: true });
  writeFileSync(join(enf, 'enforcement.csv'),
    'CASE_ID,DATE_CLOSED,RESPONDENT,RESPONDENT_TYPE,ACTION,AMOUNT,SUMMARY\n' +
    '2024EA110045,2024-09-12,GULFLINE AIR CHARTER LLC,Part 135 operator,civil_penalty,"$44,000",Missing maintenance record entries\n');

  const asrs = join(offline, 'asrs');
  mkdirSync(asrs, { recursive: true });
  writeFileSync(join(asrs, 'asrs.csv'),
    'ACN,DATE,MFR,MODEL,AIRPORT,THEMES,SYNOPSIS\n' +
    '1954102,2024-06-19,PIPER,PA-31-350,OPF,maintenance sign-off;dispatch pressure,Defer exhaust\n');

  const ctx = buildContext(base, { now: NOW, options: { offline } });
  const { records } = await runIngestion(['faa-registry', 'faa-enforcement', 'asrs'], ctx);
  assert.ok(records.every((r) => /OK/.test(r.status)), records.map((r) => `${r.source_name}:${r.status}`).join(', '));

  const store = new Datastore(join(base, 'db', 'production'));
  const a = assessAircraft(store, 'N789EF', { now: NOW });
  const enforcement = a.modules.find((m) => m.key === 'enforcement');
  assert.ok(enforcement.detail.matchCount >= 1, 'enforcement match on registrant name');
  const hf = a.modules.find((m) => m.key === 'humanFactors');
  assert.ok(hf.detail.narrativeCount >= 1, 'ASRS narrative feeds human-factors themes');
});
