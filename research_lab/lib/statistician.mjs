// Statistician — turns per-trial outputs into a frozen metric set.
//
// It cannot remove inconvenient cases (blueprint role table): it scores every
// trial the executor hands it. Abstention is a primary metric, and dangerous
// confidence is penalized far more heavily than an unavailable reading. Trials
// come in three flavours the statistician distinguishes by hidden truth:
//   * recoverable  (target present, rate recoverable)  -> expect a number
//   * unrecoverable(target present, but ambiguous/lost) -> expect abstention
//   * target absent(no subject at all)                  -> expect abstention;
//                                                          a number here is the
//                                                          most dangerous class.

export const STATISTICIAN_VERSION = '1.1.0';

export function scoreTrials(trials, opts = {}) {
  const errorTolerance = opts.error_tolerance_bpm ?? 2.0;
  const n = trials.length;

  let recoverableCount = 0;
  let unrecoverableCount = 0; // target present but not recoverable
  let targetAbsentCount = 0;
  let validOnRecoverable = 0;
  let falseConfident = 0; // confident AND numerically wrong (danger)
  let missedAbstention = 0; // did not abstain when it should have
  let correctAbstention = 0; // abstained when it should have
  let targetAbsentFalsePositive = 0; // confident output on an empty scene
  const validErrors = [];

  for (const t of trials) {
    const gt = t.ground_truth;
    const targetPresent = gt.target_present !== false && gt.true_rr_bpm !== null;
    const recoverable = targetPresent && gt.recoverable;
    if (!targetPresent) targetAbsentCount++;
    else if (recoverable) recoverableCount++;
    else unrecoverableCount++;

    const abstained = t.output.abstained;
    const shouldAbstain = !recoverable;

    if (abstained) {
      if (shouldAbstain) correctAbstention++;
      continue;
    }

    // Produced a number.
    if (!targetPresent) {
      // Confident vital sign on an empty scene — the worst failure class.
      targetAbsentFalsePositive++;
      missedAbstention++;
      falseConfident++;
      continue;
    }

    const err = Math.abs(t.output.rr_bpm - gt.true_rr_bpm);
    if (!recoverable) {
      missedAbstention++;
      if (err > errorTolerance) falseConfident++;
    } else {
      validOnRecoverable++;
      validErrors.push(err);
      if (err > errorTolerance) falseConfident++;
    }
  }

  const shouldAbstainCount = unrecoverableCount + targetAbsentCount;
  const mae = validErrors.length ? validErrors.reduce((a, b) => a + b, 0) / validErrors.length : null;
  const validCoverage = recoverableCount ? validOnRecoverable / recoverableCount : 0;
  const falseConfidentRate = n ? falseConfident / n : 0;
  const missedAbstentionRate = shouldAbstainCount ? missedAbstention / shouldAbstainCount : 0;
  const correctAbstentionRate = shouldAbstainCount ? correctAbstention / shouldAbstainCount : 0;
  const targetAbsentFpRate = targetAbsentCount ? targetAbsentFalsePositive / targetAbsentCount : 0;

  const utility = validCoverage - 5 * falseConfidentRate - 2 * missedAbstentionRate;

  return {
    statistician_version: STATISTICIAN_VERSION,
    error_tolerance_bpm: errorTolerance,
    n_trials: n,
    n_recoverable: recoverableCount,
    n_unrecoverable: unrecoverableCount,
    n_target_absent: targetAbsentCount,
    // Raw event counts — required to compute confidence bounds on rare events
    // (a rate alone hides how many trials backed it).
    false_confident_count: falseConfident,
    target_absent_false_positive_count: targetAbsentFalsePositive,
    mae_bpm: round(mae),
    p95_error_bpm: round(percentile(validErrors, 0.95)),
    valid_coverage: round(validCoverage),
    false_confident_rate: round(falseConfidentRate),
    missed_abstention_rate: round(missedAbstentionRate),
    correct_abstention_rate: round(correctAbstentionRate),
    target_absent_false_positive_rate: round(targetAbsentFpRate),
    utility: round(utility),
  };
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function round(x, d = 5) {
  if (x === null || x === undefined) return null;
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
