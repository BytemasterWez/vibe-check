// Recycled tail numbers: NTSB events belonging to a prior holder of a mark
// must not score against the current aircraft, but must remain visible.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Datastore } from '../src/datastore.js';
import { assessAircraft } from '../src/assess.js';

const NOW = new Date('2026-07-07T12:00:00Z');

function storeWith(registryRows, ntsbRows) {
  const dir = mkdtempSync(join(tmpdir(), 'aerorisk-reuse-'));
  writeFileSync(join(dir, 'registry.csv'),
    'N_NUMBER,SERIAL_NUMBER,MFR,MODEL,ENG_MFR,ENG_MODEL,YEAR_MFR,REGISTRANT_TYPE,REGISTRANT_NAME,CITY,STATE,CERT_ISSUE_DATE,AIRWORTHINESS_CLASS,STATUS,MODE_S_HEX,EXPIRATION_DATE\n' +
    registryRows.join('\n') + '\n');
  writeFileSync(join(dir, 'ntsb.csv'),
    'EVENT_ID,DATE,N_NUMBER,SERIAL_NUMBER,MFR,MODEL,OPERATOR,CITY,STATE,AIRPORT,HIGHEST_INJURY,DAMAGE,STATUS,PROBABLE_CAUSE\n' +
    ntsbRows.join('\n') + '\n');
  return new Datastore(dir);
}

test('event predating manufacture year is excluded but still shown', () => {
  const store = storeWith(
    ['N500X,SN1,CIRRUS,SR22,CONT,IO-550,2015,LLC,OWNER,CITY,CO,2016-01-01,Standard,Valid,ABC123,2030-01-01'],
    ['OLD01,1999-05-01,N500X,,PIPER,PA-28,,TOWN,TX,,Serious,Substantial,Completed,cause'],
  );
  const a = assessAircraft(store, 'N500X', { now: NOW });
  const accidents = a.modules.find((m) => m.key === 'accidents');
  assert.equal(accidents.detail.directCount, 0, 'pre-manufacture event must not count');
  assert.equal(accidents.detail.ntsbDirectEventScore, 0);
  assert.ok(
    accidents.findings.some((f) => f.severity === 'info' && /prior holder/i.test(f.text)),
    'excluded event must remain visible as an info finding',
  );
});

test('event with a mismatched manufacturer is excluded (covers blank year)', () => {
  // Current aircraft has no manufacture year (like many experimental airframes);
  // the make mismatch alone identifies the recycled tail.
  const store = storeWith(
    ['N354AA,SN3237,ANDURIL INDUSTRIES INC,ROADRUNNER,,,, LLC,ANDURIL,CITY,CA,2024-01-01,Experimental,Valid,ABC999,2030-01-01'],
    ['MIA92IA077,1992-02-08,N354AA,,Boeing,767-323ER,,MIAMI,FL,,None,,Completed,'],
  );
  const a = assessAircraft(store, 'N354AA', { now: NOW });
  const accidents = a.modules.find((m) => m.key === 'accidents');
  assert.equal(accidents.detail.directCount, 0);
  assert.ok(accidents.findings.some((f) => /different manufacturer/i.test(f.text)));
});

test('genuine same-airframe events are retained and scored', () => {
  const store = storeWith(
    ['N900H,SN9,TEXAS HELICOPTER CORP,OH-13H,LYC,VO-435,1979,Corporation,OWNER,CITY,IL,2010-01-01,Standard,Valid,ABC777,2030-01-01'],
    [
      'E1,2016-07-25,N900H,,Texas Helicopter,OH-13H,,Minonk,IL,,None,,Completed,',
      'E2,2011-07-27,N900H,,Texas Helicopter,OH-13H,,Creston,IL,,Minor,,Completed,',
    ],
  );
  const a = assessAircraft(store, 'N900H', { now: NOW });
  const accidents = a.modules.find((m) => m.key === 'accidents');
  assert.equal(accidents.detail.directCount, 2, 'post-manufacture, matching-make events must count');
  assert.ok(accidents.detail.ntsbDirectEventScore > 0);
});
