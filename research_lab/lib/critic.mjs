// Adversarial Critic — searches for confounders and alternative explanations
// for a passing result. It CANNOT modify the original results (blueprint role
// table); it only appends findings and, when it finds a plausible alternative
// explanation, records a new uncertainty and downgrades the verdict so the
// governor will not advance the claim on a possibly-spurious pass.
//
// Questions it asks (blueprint §5/§7 Family C):
//   * Did the estimator actually track the true rate, or lock onto an artifact?
//     (correlation of estimate vs truth across recoverable trials)
//   * Did the candidate genuinely beat the baseline, or merely tie it?
//     (no discriminating power => the experiment proved nothing new)
//   * Was the pass carried by the easy trials while the perturbed ones failed?

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

export function critique(execResult) {
  const findings = [];
  const trials = execResult._trials || [];

  // 1) Tracking vs artifact-locking. On recoverable trials that produced a
  // number, the estimate should correlate strongly with the true rate.
  const tracked = trials.filter((t) => t.ground_truth.recoverable && !t.output.abstained);
  const est = tracked.map((t) => t.output.rr_bpm);
  const truth = tracked.map((t) => t.ground_truth.true_rr_bpm);
  const r = pearson(est, truth);
  if (r !== null && r < 0.9) {
    findings.push({
      confounder: 'artifact_locking',
      detail: `estimate/truth correlation ${r.toFixed(3)} < 0.9 despite low MAE — the estimator may be locking onto a fixed artifact rather than tracking respiration`,
      severity: 'high',
    });
  }

  // 2) Discriminating power vs the baseline. If the candidate does not beat the
  // baseline on a perturbed campaign, the experiment did not distinguish the
  // competing explanations it was meant to.
  const cand = execResult.candidate_metrics;
  const base = execResult.baseline_metrics;
  const perturbed = (trials[0]?.ground_truth.applied_perturbations || []).length > 0;
  if (perturbed) {
    const utilityGain = cand.utility - base.utility;
    if (utilityGain <= 0.02) {
      findings.push({
        confounder: 'no_discriminating_power',
        detail: `candidate utility ${cand.utility} does not exceed baseline ${base.utility} — cancellation added no separable information on this confounder`,
        severity: 'medium',
      });
    }
  }

  // 3) Easy-trial carry. If unrecoverable trials exist, the estimator must
  // mostly abstain on them; a low correct-abstention rate means the pass leaned
  // on the clean trials while quietly emitting confident nonsense elsewhere.
  if (cand.n_unrecoverable > 0 && cand.correct_abstention_rate < 0.5) {
    findings.push({
      confounder: 'easy_trial_carry',
      detail: `correct-abstention rate ${cand.correct_abstention_rate} on unrecoverable trials — pass may be carried by clean trials`,
      severity: 'high',
    });
  }

  const highSeverity = findings.some((f) => f.severity === 'high');
  return {
    verdict: highSeverity ? 'alternative_explanation_plausible' : 'no_alternative_explanation',
    findings,
    new_uncertainty: findings.length ? findings[0].confounder : null,
    tracking_correlation: r,
  };
}
