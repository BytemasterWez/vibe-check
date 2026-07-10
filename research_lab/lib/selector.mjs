// Experiment Designer / selector — picks the next highest-information
// experiment (blueprint §5). It CANNOT execute before preregistration (role
// table); it only proposes a spec. Selection maximizes expected information
// gain rather than running thousands of trivial variations:
//
//   Priority = (ClinicalRelevance * Uncertainty * DiscriminatingPower)
//              / (ComputeCost * DuplicationRisk)

import { nextLevel, familyForAdvanceTo, isAtOrBelowCeiling, levelIndex, PRE_HARDWARE_CEILING } from './maturity.mjs';

// Default seed banks. Development ("training") and evaluation seeds are disjoint
// so an experiment is always scored on data the estimator was not tuned on.
const EVAL_SEEDS = [104, 833, 1902, 4401, 9950, 12007, 22119, 30411];

// Per-family experiment template. This is where evidence type maps to a concrete
// simulator configuration and estimator comparison.
function templateFor(family, claim) {
  const acc = claim.acceptance_contract;
  const base = {
    candidate: 'adaptive_motion_cancellation_v2',
    baseline: 'bandpass_peak_v1',
    seeds: EVAL_SEEDS,
    perturbation_salt: 7,
    acceptance: {
      mae_max: acc.mae_breaths_per_minute,
      coverage_min: acc.minimum_coverage,
      false_confident_max: 0.05,
      utility_min: 0.6,
    },
  };
  if (family === 'independent_data') {
    return {
      ...base,
      family,
      advance_to: 'C3',
      perturbations: [],
      discriminating_power: 0.5,
      hypothesis:
        'Respiratory frequency is recoverable from clean mechanistic displacement data the estimator was not tuned on.',
    };
  }
  // adversarial: a per-seed rotation mixing separable and ambiguous confounders
  // so correct abstention is exercised alongside recovery.
  return {
    ...base,
    family,
    advance_to: 'C4',
    perturbations: [['device_motion'], ['second_person'], ['sensor_dropout'], ['gross_motion']],
    discriminating_power: 1.0,
    hypothesis:
      'Respiratory frequency remains recoverable under IMU-observable apparatus motion, and the estimator abstains when a second person or long dropout makes the rate unrecoverable.',
  };
}

// The next maturity target for a claim, or null if it is at/above the ceiling.
function nextTarget(claim) {
  if (!isAtOrBelowCeiling(claim.maturity) || claim.maturity === PRE_HARDWARE_CEILING) return null;
  const target = nextLevel(claim.maturity);
  return isAtOrBelowCeiling(target) ? target : null;
}

// Score one candidate experiment for a claim.
function scoreClaim(claim, completedIds) {
  const target = nextTarget(claim);
  if (!target) return null;
  const family = familyForAdvanceTo(target);
  if (family === 'hardware_gate' || !family) return null;

  const spec = templateFor(family, claim);
  const clinicalRelevance = claim.clinical_relevance ?? 1;
  const uncertainty = 1 + (claim.open_uncertainties ? claim.open_uncertainties.length : 0);
  const discriminatingPower = spec.discriminating_power;
  const computeCost = Math.max(1, spec.seeds.length / 8); // ~cost in units of one 8-seed run
  // If we've already completed this exact experiment, running it again is pure
  // duplication — heavily penalize so the loop moves on.
  const experimentId = provisionalId(claim.claim_id, family, spec);
  const duplicationRisk = completedIds.has(experimentId) ? 100 : 1;

  const priority = (clinicalRelevance * uncertainty * discriminatingPower) / (computeCost * duplicationRisk);
  return { claim_id: claim.claim_id, target, family, spec, priority, experiment_id_hint: experimentId };
}

// Mirror prereg's id derivation closely enough to detect duplicates without
// building the full protocol (prereg remains the source of truth).
function provisionalId(claimId, family, spec) {
  return `${claimId}:${family}:${spec.candidate}`;
}

export function selectNext(claims, completedIds = new Set()) {
  const scored = claims
    .map((c) => scoreClaim(c, completedIds))
    .filter(Boolean)
    .sort((a, b) => b.priority - a.priority);
  return scored[0] || null;
}

export function rankAll(claims, completedIds = new Set()) {
  return claims
    .map((c) => scoreClaim(c, completedIds))
    .filter(Boolean)
    .sort((a, b) => b.priority - a.priority);
}

export { EVAL_SEEDS, levelIndex };
