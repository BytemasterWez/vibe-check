// Hard safety constraints (build-packet §5).
//
// A weighted utility can hide an unacceptable failure mode behind a high average
// score. In clinical sensing a high overall score must NEVER compensate for a
// dangerous confident-error class. So advancement is gated in two stages: first
// these hard constraints must ALL pass; only then does utility rank candidates.
// These are frozen alongside the acceptance contract and are checked by the
// governor at every advancement, independent of the utility score.

export const DEFAULT_CONSTRAINTS = {
  false_confident_rate_max: 0.001,
  target_absent_false_positive_rate_max: 0.001,
  reproduction_status_required: 'EXACT_MATCH',
  protocol_tamper_events_max: 0,
  unsupported_promotion_attempts_max: 0,
  critical_scenario_coverage_min: 1.0, // fraction of required world families covered
};

// Evaluate the hard constraints for an advancement decision. `context` carries
// the aggregate evidence for the claim at the tier being advanced into.
export function evaluateHardConstraints(context, constraints = DEFAULT_CONSTRAINTS) {
  const violations = [];
  const check = (name, ok, required, observed) => {
    if (!ok) violations.push({ constraint: name, required, observed });
  };

  check(
    'false_confident_rate',
    context.false_confident_rate <= constraints.false_confident_rate_max,
    `<= ${constraints.false_confident_rate_max}`,
    context.false_confident_rate
  );
  check(
    'target_absent_false_positive_rate',
    (context.target_absent_false_positive_rate ?? 0) <= constraints.target_absent_false_positive_rate_max,
    `<= ${constraints.target_absent_false_positive_rate_max}`,
    context.target_absent_false_positive_rate ?? 0
  );
  check(
    'reproduction_status',
    context.reproduction_status === constraints.reproduction_status_required,
    `== ${constraints.reproduction_status_required}`,
    context.reproduction_status
  );
  check(
    'protocol_tamper_events',
    (context.protocol_tamper_events ?? 0) <= constraints.protocol_tamper_events_max,
    `<= ${constraints.protocol_tamper_events_max}`,
    context.protocol_tamper_events ?? 0
  );
  check(
    'unsupported_promotion_attempts',
    (context.unsupported_promotion_attempts ?? 0) <= constraints.unsupported_promotion_attempts_max,
    `<= ${constraints.unsupported_promotion_attempts_max}`,
    context.unsupported_promotion_attempts ?? 0
  );
  check(
    'critical_scenario_coverage',
    (context.critical_scenario_coverage ?? 0) >= constraints.critical_scenario_coverage_min,
    `>= ${constraints.critical_scenario_coverage_min}`,
    context.critical_scenario_coverage ?? 0
  );

  return { pass: violations.length === 0, violations };
}
