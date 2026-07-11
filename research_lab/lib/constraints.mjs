// Hard safety constraints (build-packet §5, Packet 4 rare-event bounds).
//
// A weighted utility can hide an unacceptable failure mode behind a high average
// score. In clinical sensing a high overall score must NEVER compensate for a
// dangerous confident-error class. So advancement is gated in two stages: first
// these hard constraints must ALL pass; only then does utility rank candidates.
//
// Rare-event safety limits are expressed as CONFIDENCE BOUNDS, not point rates:
// "zero failures in a small test" is weak evidence. The dangerous-confidence
// classes are gated on a Clopper-Pearson 95% upper bound, which forces enough
// trials before a low rate can be believed (e.g. the target-absent bound of
// 0.001 needs ~3000 clean trials).

import { clopperPearsonUpper } from './stats.mjs';

export const DEFAULT_CONSTRAINTS = {
  // Upper-confidence-bound limits (95%, one-sided).
  false_confident_upper_bound_max: 0.02,
  target_absent_false_positive_upper_bound_max: 0.001,
  reproduction_status_required: 'EXACT_MATCH',
  protocol_tamper_events_max: 0,
  unsupported_promotion_attempts_max: 0,
  critical_scenario_coverage_min: 1.0, // fraction of required world families covered
};

// `context` supplies aggregate EVENT COUNTS and trial counts for the evidence
// backing an advancement, plus reproduction/coverage/counters.
export function evaluateHardConstraints(context, constraints = DEFAULT_CONSTRAINTS) {
  const violations = [];
  const bounds = {};
  const check = (name, ok, required, observed) => {
    if (!ok) violations.push({ constraint: name, required, observed });
  };

  const fcTrials = context.false_confident_trials ?? 0;
  const fcCount = context.false_confident_count ?? 0;
  const fcBound = fcTrials > 0 ? clopperPearsonUpper(fcCount, fcTrials) : 1;
  bounds.false_confident = { count: fcCount, trials: fcTrials, upper_bound: round(fcBound) };
  check(
    'false_confident_upper_bound',
    fcBound <= constraints.false_confident_upper_bound_max,
    `95% upper bound <= ${constraints.false_confident_upper_bound_max}`,
    `${round(fcBound)} (${fcCount}/${fcTrials})`
  );

  const taTrials = context.target_absent_trials ?? 0;
  const taCount = context.target_absent_false_positive_count ?? 0;
  // Only gate the target-absent bound when the evidence actually contains
  // target-absent trials (claims without an empty-scene step are not asked to
  // prove this here).
  if (taTrials > 0) {
    const taBound = clopperPearsonUpper(taCount, taTrials);
    bounds.target_absent_false_positive = { count: taCount, trials: taTrials, upper_bound: round(taBound) };
    check(
      'target_absent_false_positive_upper_bound',
      taBound <= constraints.target_absent_false_positive_upper_bound_max,
      `95% upper bound <= ${constraints.target_absent_false_positive_upper_bound_max}`,
      `${round(taBound)} (${taCount}/${taTrials})`
    );
  }

  check('reproduction_status', context.reproduction_status === constraints.reproduction_status_required, `== ${constraints.reproduction_status_required}`, context.reproduction_status);
  check('protocol_tamper_events', (context.protocol_tamper_events ?? 0) <= constraints.protocol_tamper_events_max, `<= ${constraints.protocol_tamper_events_max}`, context.protocol_tamper_events ?? 0);
  check('unsupported_promotion_attempts', (context.unsupported_promotion_attempts ?? 0) <= constraints.unsupported_promotion_attempts_max, `<= ${constraints.unsupported_promotion_attempts_max}`, context.unsupported_promotion_attempts ?? 0);
  check('critical_scenario_coverage', (context.critical_scenario_coverage ?? 0) >= constraints.critical_scenario_coverage_min, `>= ${constraints.critical_scenario_coverage_min}`, context.critical_scenario_coverage ?? 0);

  return { pass: violations.length === 0, violations, bounds };
}

function round(x, d = 6) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
