// Module 4 — Airworthiness Directive exposure.
// ADs are legally enforceable; compliance status lives in the aircraft's
// records, which are NOT public. So this module scores exposure (which ADs
// apply, how heavy/recurring/recent they are) and emits a document checklist
// for the pre-buy — it never asserts non-compliance.

import { daysAgo } from '../identity.js';

const COST_WEIGHT = { high: 12, medium: 7, low: 3 };

export function assessAdExposure(store, { registry, now }) {
  const applicable = store.adsForAircraft(registry);
  const findings = [];
  let score = 0;

  for (const ad of applicable) {
    const recurring = /^y(es)?$/i.test(ad.RECURRING ?? '');
    const age = daysAgo(ad.EFFECTIVE_DATE, now);
    const recent = age !== null && age <= 3 * 365;
    let w = COST_WEIGHT[(ad.COST_BAND ?? 'low').toLowerCase()] ?? 3;
    if (recurring) w += 5;
    if (recent) w += 5;
    score += w;

    const traits = [
      recurring ? 'recurring' : 'one-time',
      `${ad.COST_BAND || 'unknown'}-cost band`,
      recent ? 'recently effective' : null,
    ].filter(Boolean);
    findings.push({
      severity: recurring || (ad.COST_BAND ?? '').toLowerCase() === 'high' ? 'review' : 'info',
      text: `AD ${ad.AD_NUMBER} (effective ${ad.EFFECTIVE_DATE}) applies: ${ad.SUBJECT} — ${traits.join(', ')}. ${ad.NOTES ?? ''}`.trim(),
      evidence: [`FAA AD ${ad.AD_NUMBER}`],
    });
  }

  const checklist = applicable.map(
    (ad) => `Request logbook evidence of compliance with AD ${ad.AD_NUMBER} (${ad.SUBJECT}).`,
  );

  if (applicable.length === 0) {
    findings.push({
      severity: 'info',
      text: 'No ADs in the loaded dataset matched this airframe/engine combination. Verify against the official FAA AD database (DRS) before purchase — this dataset may be partial.',
      evidence: [],
    });
  }

  return {
    key: 'adExposure',
    label: 'AD exposure',
    score: Math.min(100, score),
    confidence: applicable.length > 0 ? 'high' : 'low',
    findings,
    narrative:
      applicable.length > 0
        ? `${applicable.length} airworthiness directive(s) apply to this airframe/engine combination. Exposure is not non-compliance: compliance evidence lives in the aircraft records — use the checklist below during the pre-buy.`
        : 'No applicable ADs found in the loaded dataset.',
    detail: { applicableCount: applicable.length, checklist },
  };
}
