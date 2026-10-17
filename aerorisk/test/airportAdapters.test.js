// Runway-incursion and wildlife-strike adapters: 5-year aggregation, the
// shared airport_risk column merge (neither adapter clobbers the other),
// species/damage summaries, mapping, and end-to-end into the airport module.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContext, runIngestion } from '../src/ingest/runner.js';
import { runwayIncursionsAdapter, normalizeIncursions } from '../src/ingest/adapters/runwayIncursions.js';
import { wildlifeStrikesAdapter, isDamaging, normalizeStrikes } from '../src/ingest/adapters/wildlifeStrikes.js';
import { countByAirportWithin, mergeAirportColumn } from '../src/ingest/airportRisk.js';
import { Datastore } from '../src/datastore.js';
import { parseCsv } from '../src/csv.js';

const NOW = new Date('2026-07-07T12:00:00Z');

function newBase() {
  return mkdtempSync(join(tmpdir(), 'aerorisk-airport-'));
}
function offlineDir(name, content) {
  const dir = mkdtempSync(join(tmpdir(), 'aerorisk-apoff-'));
  writeFileSync(join(dir, name), content);
  return dir;
}

// --- helpers -----------------------------------------------------------------

test('countByAirportWithin excludes events outside the 5-year window', () => {
  const events = [
    { A: 'SRQ', D: '2025-01-01' },
    { A: 'SRQ', D: '2024-06-01' },
    { A: 'SRQ', D: '2010-01-01' }, // too old
    { A: 'OPF', D: '' }, // no date → counted
  ];
  const counts = countByAirportWithin(events, { airportKey: 'A', dateKey: 'D', years: 5, now: NOW });
  assert.equal(counts.get('SRQ'), 2);
  assert.equal(counts.get('OPF'), 1);
});

test('mergeAirportColumn preserves the other adapter’s column', () => {
  const existing = [{ AIRPORT: 'SRQ', NAME: '', RUNWAY_INCURSIONS_5YR: '14', WILDLIFE_STRIKES_5YR: '', COASTAL: '', NOTES: '' }];
  const merged = mergeAirportColumn(existing, new Map([['SRQ', 62], ['OPF', 5]]), 'WILDLIFE_STRIKES_5YR');
  const srq = merged.find((r) => r.AIRPORT === 'SRQ');
  assert.equal(srq.RUNWAY_INCURSIONS_5YR, '14', 'runway column must survive the wildlife merge');
  assert.equal(srq.WILDLIFE_STRIKES_5YR, '62');
  assert.ok(merged.find((r) => r.AIRPORT === 'OPF'));
});

test('isDamaging treats blank/none as non-damaging, anything else as damaging', () => {
  for (const d of ['', 'N', 'No', 'NONE', 'no damage', '0']) assert.equal(isDamaging(d), false, d);
  for (const d of ['S', 'Substantial', 'M', 'D']) assert.equal(isDamaging(d), true, d);
});

// --- adapters ----------------------------------------------------------------

test('runway-incursions maps ASIAS-style headers and aggregates per airport', () => {
  const raw = parseCsv(
    'LOCATION_ID,LOCAL_DATE,RI_CATEGORY,NARRATIVE\n' +
      'SRQ,2025-03-01,C,crossed hold short\nSRQ,2024-09-01,D,taxiway confusion\nUES,2024-01-01,C,x\n',
  );
  const { rows, missing } = normalizeIncursions(raw);
  assert.deepEqual(missing, []);
  assert.equal(rows[0].AIRPORT, 'SRQ');
  assert.equal(rows[0].SEVERITY, 'C');
});

test('wildlife-strikes without offline dir is SOURCE_UNAVAILABLE', async () => {
  const record = await wildlifeStrikesAdapter.run(buildContext(newBase(), { now: NOW, options: {} }));
  assert.equal(record.status, 'SOURCE_UNAVAILABLE');
});

test('both adapters merge into one airport_risk view without clobbering', async () => {
  const base = newBase();
  const riDir = offlineDir('ri.csv',
    'AIRPORT,DATE,SEVERITY,DESCRIPTION\nSRQ,2025-03-01,C,x\nSRQ,2024-09-01,D,y\nUES,2024-01-01,C,z\n');
  const wlDir = offlineDir('wl.csv',
    'AIRPORT,INCIDENT_DATE,SPECIES,INDICATED_DAMAGE\nSRQ,2025-05-01,Gull,None\nSRQ,2024-07-01,Hawk,Substantial\nOPF,2025-02-01,Vulture,S\n');

  // Run runway first, then wildlife (as the runner orders them).
  const ctx1 = buildContext(base, { now: NOW, options: { offline: riDir } });
  assert.match((await runwayIncursionsAdapter.run(ctx1)).status, /OK/);
  const ctx2 = buildContext(base, { now: NOW, options: { offline: wlDir } });
  assert.match((await wildlifeStrikesAdapter.run(ctx2)).status, /OK/);

  const airportRisk = new Datastore(join(base, 'db', 'production')).tables.airportRisk;
  const srq = airportRisk.find((r) => r.AIRPORT === 'SRQ');
  assert.equal(srq.RUNWAY_INCURSIONS_5YR, '2');
  assert.equal(srq.WILDLIFE_STRIKES_5YR, '2', 'wildlife merge kept the runway column');

  // Damaging-strike breakdown: SRQ has 1 damaging (Substantial), gull None excluded.
  const wr = parseCsv(
    readFileSync(join(base, 'db', 'production', 'airport_wildlife_risk.csv'), 'utf8'),
  );
  assert.equal(wr.find((r) => r.AIRPORT === 'SRQ').DAMAGING_STRIKES_5YR, '1');
});

test('end-to-end: ingested airport data drives the airport context module', async () => {
  const base = newBase();
  const offline = mkdtempSync(join(tmpdir(), 'aerorisk-ap-e2e-'));

  // Registry with a flight so the airport module has airports to profile.
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

  const ri = join(offline, 'runway_incursions');
  mkdirSync(ri, { recursive: true });
  // 12 incursions at OPF within window → elevated (module threshold is 10).
  const riRows = Array.from({ length: 12 }, (_, i) => `OPF,2025-0${(i % 9) + 1}-01,C,event`).join('\n');
  writeFileSync(join(ri, 'ri.csv'), `AIRPORT,DATE,SEVERITY,DESCRIPTION\n${riRows}\n`);

  const wl = join(offline, 'wildlife_strikes');
  mkdirSync(wl, { recursive: true });
  const wlRows = Array.from({ length: 55 }, (_, i) => `OPF,2024-0${(i % 9) + 1}-15,Gull,None`).join('\n');
  writeFileSync(join(wl, 'wl.csv'), `AIRPORT,DATE,SPECIES,DAMAGE\n${wlRows}\n`);

  // Flights so the aircraft's airports include OPF.
  writeFileSync(join(reg, 'placeholder'), ''); // keep dir
  const base2 = base;
  const ctx = buildContext(base2, { now: NOW, options: { offline } });
  const { records } = await runIngestion(['faa-registry', 'runway-incursions', 'wildlife-strikes'], ctx);
  assert.ok(records.every((r) => /OK/.test(r.status)), records.map((r) => `${r.source_name}:${r.status}`).join(', '));

  // Drive the airport module directly with OPF as the operating airport.
  const store = new Datastore(join(base2, 'db', 'production'));
  const { assessAirportContext } = await import('../src/modules/airportContext.js');
  const result = assessAirportContext(store, { airports: ['OPF'] });
  assert.ok(result.score > 0);
  assert.ok(result.findings.some((f) => /runway incursions/i.test(f.text)));
  assert.ok(result.findings.some((f) => /wildlife strikes/i.test(f.text)));
});
