// Source preflight ("doctor"): probe each real endpoint and classify it, so a
// live run is one self-diagnosing command instead of guesswork. For network
// sources it makes a real request and checks BOTH reachability AND that the
// response actually parses into the shape the adapter expects — catching an
// upstream layout change before a full ingest. Offline/structured sources
// report OFFLINE_ONLY (they validate by loading a file, not by a URL).
//
// It degrades honestly: on a policy-blocked network every network source
// reports BLOCKED with the gateway's reason, and the command exits non-zero.

import { httpGetText, httpPostJson, extractLinks } from './http.js';
import { transformFrPayload, FEDERAL_REGISTER_API } from './adapters/faaAd.js';
import { DISCOVERY_PAGE, CANONICAL_ZIP_URL } from './adapters/faaRegistry.js';
import { SDR_PAGE } from './adapters/faaSdr.js';
import { NTSB_API_ROOT, buildCarolQuery, transformCarolResponse } from './adapters/ntsb.js';

export const DOCTOR = {
  OK: 'REACHABLE_SHAPE_OK',
  MISMATCH: 'REACHABLE_SHAPE_MISMATCH',
  BLOCKED: 'BLOCKED',
  UNREACHABLE: 'UNREACHABLE',
  OFFLINE_ONLY: 'OFFLINE_ONLY',
};

function classifyError(err) {
  const msg = String(err?.message ?? err);
  if (/HTTP 403|HTTP 407|CONNECT|policy|denied/i.test(msg)) return DOCTOR.BLOCKED;
  return DOCTOR.UNREACHABLE;
}

// Each network probe returns { status, detail }. Shape checks reuse the
// adapters' own transforms so "doctor says OK" means "the adapter will parse it".
const PROBES = [
  {
    source: 'faa-ad',
    kind: 'network',
    endpoint: FEDERAL_REGISTER_API,
    async probe(fetchImpl) {
      const url =
        `${FEDERAL_REGISTER_API}?per_page=2&conditions[type]=RULE` +
        '&conditions[agencies][]=federal-aviation-administration' +
        '&conditions[term]=airworthiness+directive' +
        '&fields[]=document_number&fields[]=title&fields[]=abstract' +
        '&fields[]=effective_on&fields[]=publication_date&fields[]=html_url';
      const { text } = await httpGetText(fetchImpl, url, { timeoutMs: 30_000 });
      let directives;
      try {
        directives = transformFrPayload(text);
      } catch (err) {
        return { status: DOCTOR.MISMATCH, detail: `response did not parse as Federal Register JSON: ${err.message}` };
      }
      if (directives.length === 0) {
        return { status: DOCTOR.MISMATCH, detail: 'reachable but 0 AD documents parsed — check query/fields' };
      }
      return { status: DOCTOR.OK, detail: `${directives.length} AD doc(s) parsed; sample AD ${directives[0].AD_NUMBER || '(number not in fields)'}` };
    },
  },
  {
    source: 'faa-registry',
    kind: 'network',
    endpoint: DISCOVERY_PAGE,
    async probe(fetchImpl) {
      const { text } = await httpGetText(fetchImpl, DISCOVERY_PAGE, { timeoutMs: 30_000 });
      const link = extractLinks(text, DISCOVERY_PAGE).find((h) => /ReleasableAircraft.*\.zip$/i.test(h));
      if (link) return { status: DOCTOR.OK, detail: `discovered zip link: ${link}` };
      return {
        status: DOCTOR.MISMATCH,
        detail: `page reachable but no ReleasableAircraft zip link found — adapter will fall back to ${CANONICAL_ZIP_URL}`,
      };
    },
  },
  {
    source: 'faa-sdr',
    kind: 'network',
    endpoint: SDR_PAGE,
    async probe(fetchImpl) {
      const { text } = await httpGetText(fetchImpl, SDR_PAGE, { timeoutMs: 30_000 });
      const years = extractLinks(text, SDR_PAGE)
        .filter((h) => /\.(csv|zip)(\?|$)/i.test(h))
        .map((h) => Number((h.match(/(19|20)\d{2}/) ?? [NaN])[0]))
        .filter((y) => Number.isInteger(y) && y >= 1995);
      if (years.length > 0) {
        return { status: DOCTOR.OK, detail: `discovered ${new Set(years).size} yearly file link(s), ${Math.min(...years)}–${Math.max(...years)}` };
      }
      return { status: DOCTOR.MISMATCH, detail: 'page reachable but no yearly CSV/ZIP links found — page layout may have changed' };
    },
  },
  {
    source: 'ntsb',
    kind: 'network',
    endpoint: NTSB_API_ROOT,
    async probe(fetchImpl) {
      // N106US = US Airways 1549 (Hudson) — a known real event, so a healthy
      // CAROL API must return exactly one parseable result.
      const { text } = await httpPostJson(fetchImpl, NTSB_API_ROOT, buildCarolQuery('N106US', 3), { timeoutMs: 30_000 });
      let events;
      try {
        events = transformCarolResponse(text);
      } catch (err) {
        return { status: DOCTOR.MISMATCH, detail: `reachable but response did not parse as CAROL JSON: ${err.message}` };
      }
      if (events.length === 0) {
        return { status: DOCTOR.MISMATCH, detail: 'reachable but 0 events parsed for a known tail — CAROL field names may have changed (see CAROL_FIELD_MAP)' };
      }
      return { status: DOCTOR.OK, detail: `CAROL query OK; parsed event ${events[0].EVENT_ID} (${events[0].MFR} ${events[0].MODEL})` };
    },
  },
  // Offline/structured sources: no live endpoint to probe.
  { source: 'faa-enforcement', kind: 'offline', detail: 'load a quarterly-report CSV with `ingest faa-enforcement --offline <dir>`' },
  { source: 'asrs', kind: 'offline', detail: 'load an ASRS export CSV with `ingest asrs --offline <dir>`' },
  { source: 'runway-incursions', kind: 'offline', detail: 'load an ASIAS event CSV with `ingest runway-incursions --offline <dir>`' },
  { source: 'wildlife-strikes', kind: 'offline', detail: 'load a strike CSV with `ingest wildlife-strikes --offline <dir>`' },
];

export async function runDoctor({ fetchImpl = globalThis.fetch } = {}) {
  const results = [];
  for (const p of PROBES) {
    if (p.kind === 'offline') {
      results.push({ source: p.source, kind: 'offline', status: DOCTOR.OFFLINE_ONLY, detail: p.detail });
      continue;
    }
    let result;
    try {
      result = await p.probe(fetchImpl);
    } catch (err) {
      result = { status: classifyError(err), detail: String(err.message ?? err) };
    }
    results.push({ source: p.source, kind: 'network', endpoint: p.endpoint, ...result });
  }

  const network = results.filter((r) => r.kind === 'network');
  const ready = network.length > 0 && network.every((r) => r.status === DOCTOR.OK);
  return { results, ready };
}

export function renderDoctor({ results, ready }) {
  const lines = [
    'AeroRisk source preflight',
    '',
  ];
  for (const r of results) {
    const mark =
      r.status === DOCTOR.OK ? 'OK  ' :
      r.status === DOCTOR.OFFLINE_ONLY ? 'FILE' :
      'FAIL';
    lines.push(`[${mark}] ${r.source.padEnd(20)} ${r.status}`);
    if (r.endpoint) lines.push(`       endpoint: ${r.endpoint}`);
    if (r.detail) lines.push(`       ${r.detail}`);
  }
  lines.push('');
  lines.push(
    ready
      ? 'READY: all network sources reachable and returning the expected shape.'
      : 'NOT READY: one or more network sources are blocked, unreachable, or returned an unexpected shape (see above). Offline sources still work via `ingest <source> --offline <dir>`.',
  );
  return lines.join('\n');
}
