// Campaign diversity report (build-packet §7).
//
// Aggregates receipts into the coverage picture that matters for trusting the
// campaign: which world families were exercised, which estimator families were
// compared, which confounders were seen, how the operating range was covered,
// and how abstention / false-confidence were distributed. Thin internal
// diversity is itself a finding — a claim resting on one world family or one
// estimator family has not really been stress-tested.

import { RESPIRATORY_WORLDS, ALL_WORLDS } from './simulators/index.mjs';
import { CHALLENGE_PUBLIC } from './challenges.mjs';
import { ESTIMATOR_FAMILIES } from './estimators/index.mjs';

function unique(arr) {
  return [...new Set(arr)];
}

// Confounders each challenge set exercises (declared, not the hidden schedule).
const CHALLENGE_CONFOUNDERS = {
  clean: [],
  motion: ['device_motion'],
  intruder: ['second_person'],
  target_absent: ['no_target'],
};

export function diversityReport(receipts) {
  const worlds = unique(receipts.map((r) => r.world_family).filter(Boolean));
  const candidates = unique(receipts.map((r) => r.candidate).filter(Boolean));
  const estimators = unique([...candidates, ...receipts.map((r) => r.baseline)].filter(Boolean));
  const estimatorFamilies = unique(estimators.map((e) => ESTIMATOR_FAMILIES[e]).filter(Boolean));
  const challengeSets = unique(receipts.map((r) => r.challenge_set).filter(Boolean));
  const confounders = unique(challengeSets.flatMap((c) => CHALLENGE_CONFOUNDERS[c] || []));

  const passed = receipts.filter((r) => r.result === 'PASSED');
  const abstention = summarizeNumeric(receipts.map((r) => r.primary_metrics?.correct_abstention_rate));
  const falseConfident = summarizeNumeric(receipts.map((r) => r.primary_metrics?.false_confident_rate));

  return {
    experiments: receipts.length,
    passed: passed.length,
    failed: receipts.length - passed.length,
    simulator_families_exercised: worlds,
    simulator_family_coverage: round(worlds.length / ALL_WORLDS.length),
    respiratory_world_coverage: round(
      worlds.filter((w) => RESPIRATORY_WORLDS.includes(w)).length / RESPIRATORY_WORLDS.length
    ),
    estimator_families_compared: estimatorFamilies,
    estimators_used: estimators,
    challenge_sets: challengeSets,
    confounder_coverage: confounders,
    parameter_space: parameterSpaceCoverage(receipts),
    abstention_distribution: abstention,
    false_confident_distribution: falseConfident,
    warnings: warnings(worlds, estimatorFamilies),
  };
}

// Coarse operating-range coverage: which challenge tiers were exercised.
function parameterSpaceCoverage(receipts) {
  const tiers = unique(receipts.map((r) => r.challenge_set).filter(Boolean));
  const all = Object.keys(CHALLENGE_PUBLIC);
  return { challenge_sets_seen: tiers.length, challenge_sets_total: all.length, coverage: round(tiers.length / all.length) };
}

function summarizeNumeric(values) {
  const v = values.filter((x) => typeof x === 'number');
  if (!v.length) return { n: 0, min: null, max: null, mean: null };
  const s = v.slice().sort((a, b) => a - b);
  return {
    n: v.length,
    min: round(s[0]),
    max: round(s[s.length - 1]),
    mean: round(v.reduce((a, b) => a + b, 0) / v.length),
  };
}

function warnings(worlds, estimatorFamilies) {
  const w = [];
  if (worlds.filter((x) => RESPIRATORY_WORLDS.includes(x)).length < 2)
    w.push('evidence spans fewer than two respiratory world families — cross-world validity is unproven');
  if (estimatorFamilies.length < 2)
    w.push('only one estimator family exercised — agreement may reflect shared assumptions');
  return w;
}

function round(x, d = 4) {
  if (x === null || x === undefined) return null;
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
