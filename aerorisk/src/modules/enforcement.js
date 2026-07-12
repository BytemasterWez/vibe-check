// Module 6 — Enforcement and compliance history (FAA quarterly enforcement
// reports). Labelled strictly as "public enforcement history". The module
// matches the registrant name against closed public actions; it never renders
// an "operator quality" judgement.

import { daysAgo } from '../identity.js';

const ACTION_WEIGHT = { revocation: 40, suspension: 25, civil_penalty: 15 };

export function assessEnforcement(store, { registry, now }) {
  const matches = store.enforcementForName(registry.REGISTRANT_NAME);
  const findings = [];
  let score = 0;

  for (const m of matches) {
    const action = (m.ACTION ?? '').toLowerCase();
    let w = ACTION_WEIGHT[action] ?? 10;
    const age = daysAgo(m.DATE_CLOSED, now);
    if (age !== null && age > 5 * 365) w = Math.round(w * 0.5);
    score += w;

    findings.push({
      severity: action === 'civil_penalty' ? 'review' : 'priority',
      text:
        `Public enforcement history: closed FAA case against “${m.RESPONDENT}” (${m.DATE_CLOSED}) — ` +
        `${actionLabel(action)}${m.AMOUNT ? `, ${m.AMOUNT}` : ''}. ${m.SUMMARY} ` +
        'Name-based match: confirm the respondent is the same legal entity as the current registrant before drawing conclusions.',
      evidence: [`FAA enforcement report case ${m.CASE_ID}`],
    });
  }

  if (matches.length === 0) {
    findings.push({
      severity: 'info',
      text: 'No public FAA enforcement actions matched the registrant name in the loaded dataset.',
      evidence: [],
    });
  }

  return {
    key: 'enforcement',
    label: 'Enforcement/compliance',
    score: Math.min(100, score),
    confidence: matches.length > 0 ? 'medium' : 'medium',
    findings,
    narrative:
      matches.length > 0
        ? `${matches.length} closed public enforcement action(s) matched the registrant name. These records describe public enforcement history only; matching is name-based and must be verified against the legal entity.`
        : 'No public enforcement history matched the registrant name in the loaded records.',
    detail: { matchCount: matches.length },
  };
}

function actionLabel(action) {
  switch (action) {
    case 'revocation':
      return 'certificate revocation';
    case 'suspension':
      return 'certificate suspension';
    case 'civil_penalty':
      return 'civil penalty';
    default:
      return action || 'administrative action';
  }
}
