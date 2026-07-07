// Composite scoring model. Each aircraft gets a 0–100 review-priority score,
// but the sub-scores matter more than the headline number. Identity confidence
// and report confidence are reported separately — they qualify the evidence,
// they are not risk.
//
// Language guardrails (deliberate, legally motivated): the product NEVER says
// "safe" or "unsafe". It reports what public records show and assigns a
// review priority.

export const WEIGHTS = {
  registration: 0.10,
  maintenance: 0.20,
  adExposure: 0.15,
  accidents: 0.20,
  utilisation: 0.10,
  enforcement: 0.15,
  humanFactors: 0.05,
  airport: 0.05,
};

export const SCORE_BANDS = [
  { max: 20, label: 'Low public risk signal' },
  { max: 40, label: 'Some review points' },
  { max: 60, label: 'Material due-diligence questions' },
  { max: 80, label: 'High review priority' },
  { max: 100, label: 'Serious public-risk concentration; manual expert review recommended' },
];

export function bandFor(score) {
  const s = Math.max(0, Math.min(100, score));
  return SCORE_BANDS.find((b) => s <= b.max);
}

export function reviewPriorityLanguage(score) {
  // The only sanctioned summary phrasing.
  const level = score <= 20 ? 'low' : score <= 60 ? 'moderate' : 'high';
  return `Public records show ${level} review priority.`;
}

export function compositeScore(modules) {
  let total = 0;
  let weightUsed = 0;
  for (const mod of modules) {
    const w = WEIGHTS[mod.key];
    if (w === undefined) continue;
    total += w * mod.score;
    weightUsed += w;
  }
  if (weightUsed === 0) return 0;
  return Math.round(total / weightUsed);
}

const CONFIDENCE_RANK = { none: 0, low: 1, medium: 2, high: 3 };

// Report confidence combines identity confidence with how much of the record
// set actually had data behind it.
export function reportConfidence(identity, modules) {
  const withData = modules.filter((m) => m.confidence !== 'low' && m.confidence !== 'none');
  const coverage = modules.length === 0 ? 0 : withData.length / modules.length;
  const identityRank = CONFIDENCE_RANK[identity.confidence] ?? 0;
  if (identityRank === 0) return 'none';
  if (identityRank >= 3 && coverage >= 0.6) return 'high';
  if (identityRank >= 2 && coverage >= 0.4) return 'medium';
  return 'low';
}
