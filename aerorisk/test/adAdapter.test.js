// FAA AD adapter: Federal Register JSON transform, AD-number extraction,
// best-effort text-match applicability, structured offline passthrough,
// network failure honesty, and end-to-end offline ingestion feeding the AD
// exposure module.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContext, runIngestion } from '../src/ingest/runner.js';
import {
  faaAdAdapter,
  transformFrPayload,
  extractAdNumber,
  inferApplicability,
} from '../src/ingest/adapters/faaAd.js';
import { normalizeHeader } from '../src/ingest/columnMap.js';
import { Datastore } from '../src/datastore.js';
import { assessAircraft } from '../src/assess.js';

const NOW = new Date('2026-07-07T12:00:00Z');

function newBase() {
  return mkdtempSync(join(tmpdir(), 'aerorisk-ad-'));
}

function stubFetch(handler) {
  return async (url) => {
    const result = handler(String(url));
    if (result instanceof Error) throw result;
    const { status = 200, body = '' } = result;
    return { ok: status >= 200 && status < 300, status, arrayBuffer: async () => Buffer.from(body) };
  };
}

const FR_PAYLOAD = JSON.stringify({
  results: [
    {
      document_number: '2024-08123',
      title: 'Airworthiness Directives; Piper Aircraft, Inc. (Type Certificate Previously Held by The New Piper Aircraft, Inc.) Airplanes',
      abstract: 'We are adopting a new airworthiness directive (AD) 2024-08-12 for certain Piper PA-31-350 airplanes. This AD requires inspection of the wing main spar.',
      effective_on: '2024-09-30',
      publication_date: '2024-08-16',
      regulation_id_numbers: ['2120-AA64'],
      html_url: 'https://www.federalregister.gov/documents/2024/08/16/2024-08123',
    },
    {
      document_number: '2013-05001',
      title: 'Airworthiness Directives; Cirrus Design Corporation Airplanes',
      abstract: 'This AD 2013-05-01 applies to Cirrus SR22 airplanes and requires replacement of the parachute rocket igniter line cutter.',
      effective_on: '2013-04-10',
      publication_date: '2013-03-06',
      regulation_id_numbers: [],
      html_url: 'https://www.federalregister.gov/documents/2013/03/06/2013-05001',
    },
  ],
});

test('extractAdNumber pulls AD numbers from prose, ignores non-AD text', () => {
  assert.equal(extractAdNumber('adopting AD 2024-08-12 for certain'), '2024-08-12');
  assert.equal(extractAdNumber('legacy AD 87-20-03 seat rails'), '87-20-03');
  assert.equal(extractAdNumber('no directive number here'), '');
});

test('Federal Register transform extracts AD number, dates, and source URL', () => {
  const directives = transformFrPayload(FR_PAYLOAD);
  assert.equal(directives.length, 2);
  assert.equal(directives[0].AD_NUMBER, '2024-08-12');
  assert.equal(directives[0].EFFECTIVE_DATE, '2024-09-30');
  assert.equal(directives[0].RIN, '2120-AA64');
  assert.match(directives[0].SOURCE_URL, /federalregister\.gov/);
  assert.equal(directives[1].AD_NUMBER, '2013-05-01');
});

test('applicability inference matches AD prose against registry vocab only', () => {
  const vocab = {
    makes: ['PIPER', 'CESSNA'],
    displayMake: new Map([['PIPER', 'PIPER'], ['CESSNA', 'CESSNA']]),
    displayModel: new Map([['PIPER|PA_31_350', 'PA-31-350']]),
    modelsByMake: new Map([['PIPER', ['PA_31_350']], ['CESSNA', ['172N']]]),
  };
  const directive = transformFrPayload(FR_PAYLOAD)[0];
  const rows = inferApplicability(directive, vocab);
  assert.ok(rows.some((r) => r.APPLIES_MFR === 'PIPER' && r.APPLIES_MODEL === 'PA-31-350'));
  assert.ok(rows.every((r) => r.APPLICABILITY_CONFIDENCE === 'TEXT_MATCH'));
  // Cirrus is not in this registry vocab, so a Cirrus AD yields no rows here.
  const cirrus = transformFrPayload(FR_PAYLOAD)[1];
  assert.equal(inferApplicability(cirrus, vocab).length, 0);
});

test('api mode: Federal Register 403 → BLOCKED, honestly', async () => {
  const record = await faaAdAdapter.run(
    buildContext(newBase(), { now: NOW, fetchImpl: stubFetch(() => ({ status: 403 })), options: {} }),
  );
  assert.equal(record.status, 'BLOCKED');
});

test('api mode transforms FR payload and infers applicability against registry', async () => {
  const base = newBase();
  const ctx = buildContext(base, {
    now: NOW,
    fetchImpl: stubFetch(() => ({ body: FR_PAYLOAD })),
    options: {},
  });
  // Seed a registry production table so applicability has vocab to match.
  ctx.tableStore.writeStaging(
    'faa_registry', 'aircraft_registry_current',
    ['N_NUMBER', 'MFR', 'MODEL', 'ENG_MFR', 'ENG_MODEL', 'SERIAL_NUMBER'],
    [{ N_NUMBER: 'N789EF', MFR: 'PIPER', MODEL: 'PA-31-350', ENG_MFR: 'LYCOMING', ENG_MODEL: 'TIO-540-J2BD', SERIAL_NUMBER: '31-8152077' }],
  );
  ctx.tableStore.promote('faa_registry');

  const record = await faaAdAdapter.run(ctx);
  assert.match(record.status, /OK/);
  assert.equal(record.confidence, 'low', 'text-match applicability must be low confidence');

  const applicability = ctx.tableStore.readProduction('ad_applicability');
  assert.ok(applicability.some((r) => r.AD_NUMBER === '2024-08-12' && r.APPLIES_MODEL === 'PA-31-350'));
  const ads = ctx.tableStore.readProduction('ads');
  assert.ok(ads.some((r) => /confirm against DRS/i.test(r.NOTES)));
});

test('offline structured CSV is treated as authoritative (STRUCTURED confidence)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aerorisk-ad-offline-'));
  writeFileSync(
    join(dir, 'ads.csv'),
    'AD_NUMBER,EFFECTIVE_DATE,SUBJECT,APPLIES_MFR,APPLIES_MODEL,APPLIES_ENG_MFR,APPLIES_ENG_MODEL,RECURRING,COST_BAND,NOTES\n' +
      '2020-26-16,2021-02-16,Wing main spar corrosion,PIPER,PA-31,,,yes,high,Repetitive eddy-current inspection\n',
  );
  const base = newBase();
  const ctx = buildContext(base, { now: NOW, options: { offline: dir } });
  const record = await faaAdAdapter.run(ctx);
  assert.match(record.status, /OK/);
  assert.equal(record.confidence, 'high');
  const applicability = ctx.tableStore.readProduction('ad_applicability');
  assert.equal(applicability[0].APPLICABILITY_CONFIDENCE, 'STRUCTURED');
});

test('end-to-end: ingested ADs drive the AD exposure module', async () => {
  const base = newBase();
  const offline = mkdtempSync(join(tmpdir(), 'aerorisk-ad-e2e-'));

  // Registry subdir.
  const reg = join(offline, 'faa_registry');
  mkdirSync(reg, { recursive: true });
  writeFileSync(join(reg, 'MASTER.txt'),
    'N-NUMBER,SERIAL NUMBER,MFR MDL CODE,ENG MFR MDL,YEAR MFR,TYPE REGISTRANT,NAME,STREET,STREET2,CITY,STATE,ZIP CODE,REGION,COUNTY,COUNTRY,LAST ACTION DATE,CERT ISSUE DATE,CERTIFICATION,TYPE AIRCRAFT,TYPE ENGINE,STATUS CODE,MODE S CODE,FRACT OWNER,AIR WORTH DATE,OTHER NAMES(1),OTHER NAMES(2),OTHER NAMES(3),OTHER NAMES(4),OTHER NAMES(5),EXPIRATION DATE,UNIQUE ID,KIT MFR,KIT MODEL,MODE S CODE HEX,\n' +
    '789EF   ,31-8152077      ,3930203,30015  ,1981,7,GULFLINE AIR CHARTER TRUSTEE,200 HARBOR WAY,,WILMINGTON,DE,19801,E,003,US,20251120,20251120,1 ,5,1 ,V ,53000731,N,20251101,,,,,,20321130,01099999,,,AB01D9  ,\n');
  writeFileSync(join(reg, 'ACFTREF.txt'),
    'CODE,MFR,MODEL,TYPE-ACFT,TYPE-ENG,AC-CAT,BUILD-CERT-IND,NO-ENG,NO-SEATS,AC-WEIGHT,SPEED,TC-DATA-SHEET,TC-DATA-HOLDER,\n' +
    '3930203,PIPER                         ,PA-31-350           ,5,1,1,0,2,010,CLASS 1,0195,A20SO,PIPER AIRCRAFT INC,\n');
  writeFileSync(join(reg, 'ENGINE.txt'),
    'CODE,MFR,MODEL,TYPE,HORSEPOWER,THRUST,\n' +
    '30015  ,LYCOMING  ,TIO-540-J2BD   ,1 ,00350,000000,\n');

  // AD subdir: structured, authoritative.
  const ad = join(offline, 'faa_ad');
  mkdirSync(ad, { recursive: true });
  writeFileSync(join(ad, 'ads.csv'),
    'AD_NUMBER,EFFECTIVE_DATE,SUBJECT,APPLIES_MFR,APPLIES_MODEL,APPLIES_ENG_MFR,APPLIES_ENG_MODEL,RECURRING,COST_BAND,NOTES\n' +
    '2020-26-16,2021-02-16,Wing main spar lower cap corrosion,PIPER,PA-31,,,yes,high,Repetitive eddy-current inspection\n' +
    '75-08-09,1975-05-02,Exhaust system inspection,,,LYCOMING,TIO-540,yes,medium,Repetitive exhaust inspection\n');

  const ctx = buildContext(base, { now: NOW, options: { offline } });
  const { records } = await runIngestion(['faa-registry', 'faa-ad'], ctx);
  assert.ok(records.every((r) => /OK/.test(r.status)), records.map((r) => `${r.source_name}:${r.status}`).join(', '));

  const store = new Datastore(join(base, 'db', 'production'));
  const a = assessAircraft(store, 'N789EF', { now: NOW });
  const adMod = a.modules.find((m) => m.key === 'adExposure');
  assert.ok(adMod.detail.applicableCount >= 2, `expected spar + exhaust ADs, got ${adMod.detail.applicableCount}`);
  assert.ok(adMod.detail.checklist.some((c) => /2020-26-16/.test(c)));
});
