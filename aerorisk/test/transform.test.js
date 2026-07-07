// Verifies the FAA Releasable Aircraft transform against a fixture that
// reproduces the official file layout (per the FAA ardata data dictionary):
// N-numbers without the N prefix, coded make/model/engine references,
// YYYYMMDD dates, coded registrant/status/certification fields, padded
// values, and a trailing comma on every row. Then runs the transformed
// output through the full assessment pipeline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformReleasableAircraft } from '../src/sources/transformFaaRegistry.js';
import { Datastore } from '../src/datastore.js';
import { assessAircraft } from '../src/assess.js';

const MASTER = [
  'N-NUMBER,SERIAL NUMBER,MFR MDL CODE,ENG MFR MDL,YEAR MFR,TYPE REGISTRANT,NAME,STREET,STREET2,CITY,STATE,ZIP CODE,REGION,COUNTY,COUNTRY,LAST ACTION DATE,CERT ISSUE DATE,CERTIFICATION,TYPE AIRCRAFT,TYPE ENGINE,STATUS CODE,MODE S CODE,FRACT OWNER,AIR WORTH DATE,OTHER NAMES(1),OTHER NAMES(2),OTHER NAMES(3),OTHER NAMES(4),OTHER NAMES(5),EXPIRATION DATE,UNIQUE ID,KIT MFR,KIT MODEL,MODE S CODE HEX,',
  '123AB   ,17269021        ,2072813,17003  ,1978,3,SUNCOAST FLIGHT ACADEMY LLC,101 AIRPORT RD,,SARASOTA,FL,34243,S,115,US,20240108,20190314,1N,4,1 ,V ,52603621,N,20240301,,,,,,20270331,01088888,,,A05F21  ,',
  '789EF   ,31-8152077      ,3930203,30015  ,1981,7,GULFLINE AIR CHARTER TRUSTEE,200 HARBOR WAY,,WILMINGTON,DE,19801,E,003,US,20251120,20251120,1 ,5,1 ,V ,53000731,N,20251101,,,,,,20321130,01099999,,,AB01D9  ,',
  '55555   ,NOREF-1         ,9999999,       ,2001,1,JANE EXAMPLE,1 MAIN ST,,DENVER,CO,80014,N,031,US,20230601,20230601,4 ,4,1 ,E ,50000001,N,20230601,,,,,,20250630,01077777,,,A6F0D2  ,',
].join('\n');

const ACFTREF = [
  'CODE,MFR,MODEL,TYPE-ACFT,TYPE-ENG,AC-CAT,BUILD-CERT-IND,NO-ENG,NO-SEATS,AC-WEIGHT,SPEED,TC-DATA-SHEET,TC-DATA-HOLDER,',
  '2072813,CESSNA                        ,172N                ,4,1,1,0,1,004,CLASS 1,0105,3A12,TEXTRON AVIATION INC,',
  '3930203,PIPER                         ,PA-31-350           ,5,1,1,0,2,010,CLASS 1,0195,A20SO,PIPER AIRCRAFT INC,',
].join('\n');

const ENGINE = [
  'CODE,MFR,MODEL,TYPE,HORSEPOWER,THRUST,',
  '17003  ,LYCOMING  ,O-320-H2AD     ,1 ,00160,000000,',
  '30015  ,LYCOMING  ,TIO-540-J2BD   ,1 ,00350,000000,',
].join('\n');

const result = transformReleasableAircraft({
  masterText: MASTER,
  acftrefText: ACFTREF,
  engineText: ENGINE,
});

test('transforms MASTER rows joining make/model and engine references', () => {
  assert.equal(result.count, 3);
  const rows = Object.fromEntries(
    result.registryCsv
      .split('\n')
      .slice(1)
      .map((line) => [line.split(',')[0], line]),
  );
  assert.match(rows.N123AB, /CESSNA,172N,LYCOMING,O-320-H2AD/);
  assert.match(rows.N123AB, /Corporation/);
  assert.match(rows.N123AB, /2019-03-14/);
  assert.match(rows.N123AB, /Standard/);
  assert.match(rows.N123AB, /Valid/);
  assert.match(rows.N123AB, /A05F21/);
  assert.match(rows.N789EF, /PIPER,PA-31-350,LYCOMING,TIO-540-J2BD/);
  assert.match(rows.N789EF, /LLC/);
});

test('maps status and airworthiness codes, flags unknown reference codes', () => {
  const n55555 = result.registryCsv.split('\n').find((l) => l.startsWith('N55555'));
  assert.match(n55555, /Experimental/);
  assert.match(n55555, /Expired/);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /N55555: unknown MFR MDL CODE/);
});

test('transformed output feeds the assessment pipeline end to end', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aerorisk-transform-'));
  writeFileSync(join(dir, 'registry.csv'), `${result.registryCsv}\n`);

  const store = new Datastore(dir);
  const a = assessAircraft(store, 'N123AB', { now: new Date('2026-07-07T12:00:00Z') });

  assert.equal(a.identity.confidence, 'high');
  assert.equal(a.registry.MFR, 'CESSNA');
  assert.equal(a.registry.MODEL, '172N');
  assert.equal(typeof a.score, 'number');
  // Registry-only data directory: every other feed degrades to "no data".
  const maintenance = a.modules.find((m) => m.key === 'maintenance');
  assert.equal(maintenance.detail.tailSdrCount, 0);
});
