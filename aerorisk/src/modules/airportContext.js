// Module 8 — Airport risk context (FAA ASIAS runway-incursion data and the
// FAA Wildlife Strike Database). Environmental context for where the aircraft
// operates — informs insurance and inspection focus, says nothing about the
// aircraft or any operator's conduct.

export function assessAirportContext(store, { airports }) {
  const findings = [];
  let score = 0;
  const profiles = [];

  for (const code of airports ?? []) {
    const ap = store.airportRisk(code);
    if (!ap) continue;
    profiles.push(ap);

    const incursions = Number(ap.RUNWAY_INCURSIONS_5YR || 0);
    const strikes = Number(ap.WILDLIFE_STRIKES_5YR || 0);

    if (incursions >= 10) {
      score += 15;
      findings.push({
        severity: 'review',
        text: `${code} (${ap.NAME}) recorded ${incursions} runway incursions over five years — an elevated surface-risk environment${ap.NOTES ? ` (${ap.NOTES})` : ''}.`,
        evidence: [`FAA ASIAS runway incursion data: ${code}`],
      });
    } else if (incursions >= 5) {
      score += 8;
      findings.push({
        severity: 'info',
        text: `${code} (${ap.NAME}) recorded ${incursions} runway incursions over five years — moderate surface-risk context.`,
        evidence: [`FAA ASIAS runway incursion data: ${code}`],
      });
    }

    if (strikes >= 50) {
      score += 10;
      findings.push({
        severity: 'review',
        text: `${code} (${ap.NAME}) recorded ${strikes} wildlife strikes over five years — inspect for strike-repair history and factor into insurance discussion.`,
        evidence: [`FAA Wildlife Strike Database: ${code}`],
      });
    }
  }

  if (profiles.length === 0) {
    findings.push({
      severity: 'info',
      text: 'No airport risk profiles matched the aircraft’s operating airports in the loaded dataset.',
      evidence: [],
    });
  }

  return {
    key: 'airport',
    label: 'Airport exposure',
    score: Math.min(100, score),
    confidence: profiles.length > 0 ? 'medium' : 'low',
    findings,
    narrative:
      profiles.length > 0
        ? `Operating-environment context for ${profiles.map((p) => p.AIRPORT).join(', ')}. Airport risk describes the environment, not the aircraft or operator.`
        : 'Operating-airport risk context unavailable in the loaded records.',
    detail: { airportsProfiled: profiles.map((p) => p.AIRPORT) },
  };
}
