// Registration and ownership complexity: ownership changes, trusts,
// registration churn. Complexity is a due-diligence signal, not an accusation —
// trusts and LLC registration are common and often entirely routine.

import { daysAgo } from '../identity.js';

const TRUST_RE = /\bTRUST(EE)?\b/i;

export function assessRegistration(store, { registry, now }) {
  const findings = [];
  const history = store.historyForAircraft(registry.N_NUMBER);
  const ownershipEvents = history.filter((h) => /ownership|registration/i.test(h.EVENT));
  const recentEvents = ownershipEvents.filter((h) => {
    const age = daysAgo(h.DATE, now);
    return age !== null && age <= 5 * 365;
  });

  let score = 0;

  if (recentEvents.length >= 3) {
    score += 40;
    findings.push({
      severity: 'priority',
      text: `${recentEvents.length} ownership/registration changes in the past five years — registration churn worth explaining before purchase.`,
      evidence: recentEvents.map((h) => `Registry history ${h.DATE}: ${h.EVENT} — ${h.DETAILS}`),
    });
  } else if (recentEvents.length === 2) {
    score += 20;
    findings.push({
      severity: 'review',
      text: 'Two ownership/registration changes in the past five years; ask the seller to walk through the chain of ownership.',
      evidence: recentEvents.map((h) => `Registry history ${h.DATE}: ${h.EVENT} — ${h.DETAILS}`),
    });
  }

  if (TRUST_RE.test(registry.REGISTRANT_NAME ?? '')) {
    score += 20;
    findings.push({
      severity: 'review',
      text: `Registered to a trustee/trust entity (“${registry.REGISTRANT_NAME}”). Common and often routine, but it obscures the beneficial owner — request the trust agreement or owner disclosure during due diligence.`,
      evidence: [`FAA registry record for ${registry.N_NUMBER}`],
    });
  }

  const lastChange = ownershipEvents.at(-1);
  if (lastChange) {
    const age = daysAgo(lastChange.DATE, now);
    if (age !== null && age <= 365) {
      score += 15;
      findings.push({
        severity: 'review',
        text: `Most recent registration change was ${lastChange.DATE} (${age} days ago). A fresh re-registration shortly before a sale deserves a question.`,
        evidence: [`Registry history ${lastChange.DATE}: ${lastChange.EVENT} — ${lastChange.DETAILS}`],
      });
    }
  }

  if (history.length === 0) {
    findings.push({
      severity: 'info',
      text: 'No registration-history rows in the loaded dataset; ownership timeline could not be evaluated.',
      evidence: [],
    });
  }

  return {
    key: 'registration',
    label: 'Registration complexity',
    score: Math.min(100, score),
    confidence: history.length > 0 ? 'high' : 'low',
    findings,
    narrative:
      findings.length > 0 && score > 0
        ? 'Public registry history shows ownership/registration complexity worth reviewing. None of this is evidence of wrongdoing; it defines what to ask the seller.'
        : 'Registration history in the loaded records looks unremarkable.',
  };
}
