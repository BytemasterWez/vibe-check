// Batch enrichment driver — the V1 target: N-numbers in → registry matches →
// SDR/NTSB/AD enrichment attempted for each → scoring generated → evidence
// links stored → coverage report produced.
//
// Reads a promoted production data directory (from `aerorisk ingest`) and
// runs the assessment pipeline over a list of N-numbers, emitting a per-
// aircraft records CSV, a full JSON, and a coverage report scored against the
// V1 gate. This is the systemised replacement for one-off manual reports.

import { normalizeNNumber } from './identity.js';
import { assessAircraft } from './assess.js';
import { toCsv } from './ingest/tableStore.js';

const RECORD_COLUMNS = [
  'N_NUMBER', 'RESOLVED', 'IDENTITY_CONFIDENCE', 'MFR', 'MODEL',
  'OVERALL_REVIEW_PRIORITY', 'BAND', 'REPORT_CONFIDENCE',
  'REGISTRATION_STATUS_SCORE', 'DEREGISTRATION_HISTORY_FLAG',
  'SDR_TAIL_SCORE', 'SDR_MODEL_SCORE', 'NTSB_DIRECT_EVENT_SCORE',
  'NTSB_MODEL_CONTEXT_SCORE', 'AD_EXPOSURE_SCORE',
  'EVIDENCE_COUNT', 'TOP_FINDING',
];

function componentValue(breakdown, name) {
  const c = breakdown.find((x) => x.name === name);
  return c ? c.value : '';
}

export function runBatch(store, rawNNumbers, { now = new Date() } = {}) {
  const seen = new Set();
  const nNumbers = rawNNumbers
    .map((n) => normalizeNNumber(n))
    .filter((n) => n && !seen.has(n) && seen.add(n));

  const records = [];
  const assessments = [];

  for (const n of nNumbers) {
    const a = assessAircraft(store, n, { now });
    assessments.push(a);
    const resolved = Boolean(a.identity.registry);
    const bd = a.scoreBreakdown ?? [];
    const evidenceCount = resolved
      ? a.findings.reduce((s, f) => s + (f.evidence?.length ?? 0), 0)
      : 0;

    records.push({
      N_NUMBER: n,
      RESOLVED: resolved ? 'yes' : 'no',
      IDENTITY_CONFIDENCE: a.identity.confidence,
      MFR: a.registry?.MFR ?? '',
      MODEL: a.registry?.MODEL ?? '',
      OVERALL_REVIEW_PRIORITY: resolved ? a.score : '',
      BAND: a.band?.label ?? '',
      REPORT_CONFIDENCE: a.reportConfidence ?? '',
      REGISTRATION_STATUS_SCORE: componentValue(bd, 'registration_status_score'),
      DEREGISTRATION_HISTORY_FLAG: resolved ? (componentValue(bd, 'deregistration_history_flag') ? 'yes' : 'no') : '',
      SDR_TAIL_SCORE: componentValue(bd, 'sdr_tail_score'),
      SDR_MODEL_SCORE: componentValue(bd, 'sdr_model_score'),
      NTSB_DIRECT_EVENT_SCORE: componentValue(bd, 'ntsb_direct_event_score'),
      NTSB_MODEL_CONTEXT_SCORE: componentValue(bd, 'ntsb_model_context_score'),
      AD_EXPOSURE_SCORE: componentValue(bd, 'ad_exposure_score'),
      EVIDENCE_COUNT: evidenceCount,
      TOP_FINDING: a.topFindings?.[0]?.text ?? '',
    });
  }

  const resolvedRecords = records.filter((r) => r.RESOLVED === 'yes');
  const coverage = {
    submitted: nNumbers.length,
    resolved: resolvedRecords.length,
    // Enrichment is "attempted" for every resolved aircraft — each module
    // runs and reports, even when it finds nothing.
    sdrAttempted: resolvedRecords.length,
    ntsbAttempted: resolvedRecords.length,
    adAttempted: resolvedRecords.length,
    scored: resolvedRecords.length,
    withEvidence: resolvedRecords.filter((r) => Number(r.EVIDENCE_COUNT) > 0).length,
    withDirectSignal: resolvedRecords.filter(
      (r) => Number(r.SDR_TAIL_SCORE) > 0 || Number(r.NTSB_DIRECT_EVENT_SCORE) > 0,
    ).length,
  };

  return { records, assessments, coverage, columns: RECORD_COLUMNS };
}

export function recordsCsv(result) {
  return `${toCsv(result.columns, result.records)}\n`;
}

// V1 gate: 100 in → 100 registry matches → enrichment attempted for all →
// scoring generated → evidence stored. This renders the gate result.
export function renderBatchReport(result, { now = new Date() } = {}) {
  const c = result.coverage;
  const pct = (n) => (c.submitted === 0 ? '0' : Math.round((n / c.submitted) * 100));
  const gatePass = c.resolved === c.submitted && c.scored === c.resolved && c.submitted > 0;

  const lines = [
    `# AeroRisk batch enrichment — ${now.toISOString().slice(0, 10)}`,
    '',
    `Submitted **${c.submitted}** N-numbers.`,
    '',
    '| Stage | Count | Coverage |',
    '| --- | --- | --- |',
    `| Registry matches (resolved) | ${c.resolved} | ${pct(c.resolved)}% |`,
    `| SDR enrichment attempted | ${c.sdrAttempted} | ${pct(c.sdrAttempted)}% |`,
    `| NTSB enrichment attempted | ${c.ntsbAttempted} | ${pct(c.ntsbAttempted)}% |`,
    `| AD enrichment attempted | ${c.adAttempted} | ${pct(c.adAttempted)}% |`,
    `| Scoring generated | ${c.scored} | ${pct(c.scored)}% |`,
    `| Records with evidence links | ${c.withEvidence} | ${pct(c.withEvidence)}% |`,
    `| Aircraft with a direct (tail/serial) signal | ${c.withDirectSignal} | ${pct(c.withDirectSignal)}% |`,
    '',
    `**V1 gate:** ${gatePass ? 'PASS' : 'INCOMPLETE'} — ` +
      (gatePass
        ? 'every submitted aircraft resolved and was scored.'
        : `${c.submitted - c.resolved} aircraft did not resolve against the loaded registry (check the N-numbers or ingest a fuller registry).`),
    '',
    '## Highest review priority',
    '',
    '| N-number | Aircraft | Score | Band | Top finding |',
    '| --- | --- | --- | --- | --- |',
    ...result.records
      .filter((r) => r.RESOLVED === 'yes')
      .sort((a, b) => Number(b.OVERALL_REVIEW_PRIORITY) - Number(a.OVERALL_REVIEW_PRIORITY))
      .slice(0, 20)
      .map(
        (r) =>
          `| ${r.N_NUMBER} | ${r.MFR} ${r.MODEL} | ${r.OVERALL_REVIEW_PRIORITY} | ${r.BAND} | ${(r.TOP_FINDING || '—').replace(/\|/g, '\\|').slice(0, 120)} |`,
      ),
  ];

  if (result.records.some((r) => r.RESOLVED === 'no')) {
    lines.push(
      '',
      '## Unresolved',
      '',
      ...result.records.filter((r) => r.RESOLVED === 'no').map((r) => `- ${r.N_NUMBER}`),
    );
  }

  return lines.join('\n');
}
