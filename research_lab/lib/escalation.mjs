// Escalation categories + digests (build-packet §7, §10).
//
// The loop reduces everything it cannot resolve autonomously to ONE decision in
// ONE of these categories, and emits both a compact machine-readable digest and
// a human-readable decision brief. Your attention is required only here.

export const ESCALATION = {
  NEEDS_NEW_SIMULATOR: 'a required world/confounder has no simulator family',
  NEEDS_EXTERNAL_DATASET: 'progress needs independent public-dataset evidence',
  NEEDS_HARDWARE: 'progress needs physical apparatus (software ceiling reached)',
  NEEDS_HUMAN_LABELS: 'progress needs human-annotated observations',
  NEEDS_CLINICAL_REVIEW: 'a clinical-risk judgement or claim promotion is required',
  CLAIM_FALSIFIED: 'the claim as stated failed under valid, reproduced evidence',
  SOFTWARE_CEILING_REACHED: 'all software-testable evidence gathered; C5 reached',
};

export function isEscalationCategory(cat) {
  return Object.prototype.hasOwnProperty.call(ESCALATION, cat);
}

// A compact, machine-readable escalation object for automation.
export function machineDigest({ category, claim, evidence = {}, detail = null }) {
  return {
    kind: 'escalation',
    category,
    category_meaning: ESCALATION[category] || 'unknown',
    claim_id: claim.claim_id,
    maturity: claim.maturity,
    detail,
    evidence: {
      experiments: evidence.experiments ?? null,
      passed: evidence.passed ?? null,
      failed: evidence.failed ?? null,
      simulator_families: evidence.simulator_families ?? [],
      estimator_families: evidence.estimator_families ?? [],
    },
    open_uncertainties: claim.open_uncertainties || [],
    requires_expenditure: category === 'NEEDS_HARDWARE' || category === 'NEEDS_EXTERNAL_DATASET',
    autonomous_action_available: false,
  };
}

// A human-readable one-decision brief (blueprint §13 shape).
export function decisionBrief({ category, claim, evidence = {}, detail = null, recommendation }) {
  const fams = (evidence.simulator_families || []).join(', ') || 'none';
  const lines = [
    `DECISION REQUIRED: ${claim.claim_id}  [${category}]`,
    `Meaning: ${ESCALATION[category] || 'unknown'}`,
    `Pre-hardware status: ${claim.maturity}`,
    `Statement: ${claim.statement}`,
    `Evidence: ${evidence.experiments ?? 0} experiments (passed ${evidence.passed ?? 0}, failed ${evidence.failed ?? 0})`,
    `Simulator families exercised: ${fams}`,
  ];
  if (detail) lines.push(`Detail: ${detail}`);
  lines.push(`Unresolved: ${(claim.open_uncertainties || []).join(', ') || 'none tracked'}`);
  lines.push(`Recommendation: ${recommendation || defaultRecommendation(category)}`);
  return lines.join('\n');
}

function defaultRecommendation(category) {
  switch (category) {
    case 'NEEDS_HARDWARE':
      return 'Do not purchase until every claim has reached its software ceiling; then buy the smallest board that measures the specific unresolved quantity.';
    case 'NEEDS_NEW_SIMULATOR':
      return 'Author an independent world/confounder model before spending on data or hardware.';
    case 'NEEDS_EXTERNAL_DATASET':
      return 'Identify a licensed public dataset with a matching population and reference standard.';
    case 'CLAIM_FALSIFIED':
      return 'Rewrite the claim to its supported boundary, or retire it; do not weaken the frozen thresholds.';
    case 'SOFTWARE_CEILING_REACHED':
      return 'Review the software evidence and decide whether the specific hardware experiment is justified.';
    default:
      return 'Review the evidence and decide the next step.';
  }
}
