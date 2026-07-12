// Doctor preflight: proves each network source is classified correctly for
// reachable-good-shape, reachable-bad-shape, and blocked cases (using injected
// responses, since the real endpoints are unreachable from CI/sandboxes), and
// that offline sources report OFFLINE_ONLY.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDoctor, renderDoctor, DOCTOR } from '../src/ingest/doctor.js';

function stub(handler) {
  return async (url) => {
    const r = handler(String(url));
    if (r instanceof Error) throw r;
    const { status = 200, body = '' } = r;
    return { ok: status >= 200 && status < 300, status, arrayBuffer: async () => Buffer.from(body) };
  };
}

const FR_OK = JSON.stringify({
  results: [
    { document_number: '2024-08123', title: 'Airworthiness Directives; AD 2024-08-12', abstract: 'AD 2024-08-12 applies', effective_on: '2024-09-30', html_url: 'https://x' },
  ],
});
const REGISTRY_PAGE_OK = '<a href="https://registry.faa.gov/database/ReleasableAircraft.zip">DB</a>';
const SDR_PAGE_OK = '<a href="/f/sdr_2024.csv">2024</a><a href="/f/sdr_1995.csv">1995</a>';
const NTSB_OK = JSON.stringify({
  Results: [{ EntryId: 'x', Fields: [
    { FieldName: 'NtsbNo', Values: ['DCA09MA026'] },
    { FieldName: 'EventDate', Values: ['2009-01-15T16:30:00Z'] },
    { FieldName: 'N#', Values: ['N106US'] },
    { FieldName: 'VehicleMake', Values: ['Airbus'] },
    { FieldName: 'VehicleModel', Values: ['A320'] },
  ] }],
});

function route(map) {
  return stub((url) => {
    for (const [needle, resp] of map) {
      if (url.includes(needle)) return resp;
    }
    return { status: 404 };
  });
}

test('all network sources reachable with good shape → READY', async () => {
  const fetchImpl = route([
    ['federalregister.gov', { body: FR_OK }],
    ['releasable_aircraft_download', { body: REGISTRY_PAGE_OK }],
    ['sdrs.faa.gov', { body: SDR_PAGE_OK }],
    ['data.ntsb.gov', { body: NTSB_OK }],
  ]);
  const outcome = await runDoctor({ fetchImpl });
  assert.equal(outcome.ready, true);
  const byName = Object.fromEntries(outcome.results.map((r) => [r.source, r]));
  assert.equal(byName['faa-ad'].status, DOCTOR.OK);
  assert.equal(byName['faa-registry'].status, DOCTOR.OK);
  assert.equal(byName['faa-sdr'].status, DOCTOR.OK);
  assert.equal(byName.ntsb.status, DOCTOR.OK);
  // Offline sources are always OFFLINE_ONLY.
  assert.equal(byName['faa-enforcement'].status, DOCTOR.OFFLINE_ONLY);
  assert.equal(byName.asrs.status, DOCTOR.OFFLINE_ONLY);
  assert.match(renderDoctor(outcome), /READY: all network sources/);
});

test('reachable but wrong shape → MISMATCH, not READY', async () => {
  const fetchImpl = route([
    ['federalregister.gov', { body: 'not json' }],
    ['releasable_aircraft_download', { body: '<html>no zip link here</html>' }],
    ['sdrs.faa.gov', { body: '<html>no year files</html>' }],
    ['data.ntsb.gov', { body: '<html>not json</html>' }],
  ]);
  const outcome = await runDoctor({ fetchImpl });
  assert.equal(outcome.ready, false);
  const byName = Object.fromEntries(outcome.results.map((r) => [r.source, r]));
  assert.equal(byName['faa-ad'].status, DOCTOR.MISMATCH);
  assert.equal(byName['faa-registry'].status, DOCTOR.MISMATCH);
  assert.equal(byName['faa-sdr'].status, DOCTOR.MISMATCH);
  assert.equal(byName.ntsb.status, DOCTOR.MISMATCH);
});

test('policy 403 → BLOCKED; other errors → UNREACHABLE', async () => {
  const blocked = await runDoctor({ fetchImpl: stub(() => ({ status: 403 })) });
  assert.equal(blocked.ready, false);
  assert.ok(blocked.results.filter((r) => r.kind === 'network').every((r) => r.status === DOCTOR.BLOCKED));
  assert.match(renderDoctor(blocked), /NOT READY/);

  const down = await runDoctor({ fetchImpl: stub(() => new Error('getaddrinfo ENOTFOUND host')) });
  assert.ok(down.results.filter((r) => r.kind === 'network').every((r) => r.status === DOCTOR.UNREACHABLE));
});

test('a single blocked source among healthy ones still blocks READY', async () => {
  const fetchImpl = route([
    ['federalregister.gov', { body: FR_OK }],
    ['releasable_aircraft_download', { body: REGISTRY_PAGE_OK }],
    ['sdrs.faa.gov', { status: 403 }],
    ['data.ntsb.gov', { body: '{"results":[]}' }],
  ]);
  const outcome = await runDoctor({ fetchImpl });
  assert.equal(outcome.ready, false);
  const byName = Object.fromEntries(outcome.results.map((r) => [r.source, r]));
  assert.equal(byName['faa-sdr'].status, DOCTOR.BLOCKED);
  assert.equal(byName['faa-ad'].status, DOCTOR.OK);
});
