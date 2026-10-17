// Module 7 — Human-factors themes (NASA ASRS narratives).
// ASRS reports are voluntary, self-reported, unverified, and subject to
// reporting bias. This module therefore carries the lowest weight in the
// composite score and every output is labelled a "human-factors theme" —
// never a judgement about any pilot, mechanic, or training programme.

export const ASRS_CAVEAT =
  'ASRS narratives are voluntary, self-reported, and not independently verified. ' +
  'Themes below are context for briefing and inspection focus only.';

export function assessHumanFactors(store, { registry, airports }) {
  const records = store.asrsForContext(registry.MFR, registry.MODEL, airports);
  const findings = [];

  const themeCounts = new Map();
  for (const rec of records) {
    for (const theme of (rec.THEMES ?? '').split(';').map((t) => t.trim()).filter(Boolean)) {
      if (!themeCounts.has(theme)) themeCounts.set(theme, []);
      themeCounts.get(theme).push(rec);
    }
  }

  const ranked = [...themeCounts.entries()].sort((a, b) => b[1].length - a[1].length);
  let score = 0;
  for (const [theme, recs] of ranked.slice(0, 5)) {
    score += Math.min(12, 4 + recs.length * 2);
    findings.push({
      severity: 'info',
      text: `Human-factors theme (${recs.length} ASRS narrative(s)): ${theme} — reported around this model or its operating airports. ${ASRS_CAVEAT}`,
      evidence: recs.map((r) => `NASA ASRS ACN ${r.ACN} (${r.DATE})`),
    });
  }

  if (records.length === 0) {
    findings.push({
      severity: 'info',
      text: 'No ASRS narratives matched this model or its operating airports in the loaded dataset.',
      evidence: [],
    });
  }

  return {
    key: 'humanFactors',
    label: 'Human-factors themes',
    score: Math.min(100, score),
    confidence: 'low',
    findings,
    narrative:
      records.length > 0
        ? `${records.length} ASRS narrative(s) provide human-factors context for this model/airport environment. ${ASRS_CAVEAT}`
        : 'No human-factors narratives matched in the loaded records.',
    detail: {
      narrativeCount: records.length,
      themes: ranked.map(([theme, recs]) => ({ theme, count: recs.length })),
    },
  };
}
