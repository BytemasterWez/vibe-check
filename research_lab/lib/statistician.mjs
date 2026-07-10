// Statistician — turns per-trial outputs into a frozen metric set.
//
// It cannot remove inconvenient cases (blueprint role table): it scores every
// trial the executor hands it. Abstention is a primary metric, and dangerous
// confidence is penalized far more heavily than an unavailable reading.
//
// Per trial the executor supplies { output, ground_truth }. We compare the
// estimator's decision against two hidden truths: the true rate (for error) and
// whether the rate was recoverable at all (for abstention correctness).

export const STATISTICIAN_VERSION = '1.0.0';

export function scoreTrials(trials, opts = {}) {
  const errorTolerance = opts.error_tolerance_bpm ?? 2.0; // "confident nonsense" line
  const n = trials.length;

  let recoverableCount = 0;
  let validOnRecoverable = 0; // produced a number on a recoverable trial
  let abstentions = 0;
  let falseConfident = 0; // produced a number that is wrong beyond tolerance
  let missedAbstention = 0; // did not abstain when the rate was unrecoverable
  let correctAbstention = 0; // abstained when the rate was unrecoverable
  const validErrors = []; // |err| on recoverable trials where a number was given

  for (const t of trials) {
    const recoverable = t.ground_truth.recoverable;
    if (recoverable) recoverableCount++;
    const abstained = t.output.abstained;

    if (abstained) {
      abstentions++;
      if (!recoverable) correctAbstention++;
      continue;
    }

    // Produced a number.
    const err = Math.abs(t.output.rr_bpm - t.ground_truth.true_rr_bpm);

    if (!recoverable) {
      // Any confident output on an unrecoverable trial is a missed abstention…
      missedAbstention++;
      // …and if it is also numerically wrong it is dangerous confidence.
      if (err > errorTolerance) falseConfident++;
    } else {
      validOnRecoverable++;
      validErrors.push(err);
      if (err > errorTolerance) falseConfident++;
    }
  }

  const unrecoverableCount = n - recoverableCount;
  const validOutputs = validOnRecoverable;
  const mae = validErrors.length
    ? validErrors.reduce((a, b) => a + b, 0) / validErrors.length
    : null;
  const p95 = percentile(validErrors, 0.95);

  // Coverage is over recoverable trials: of the readings we *should* be able to
  // produce, how many did we produce?
  const validCoverage = recoverableCount ? validOutputs / recoverableCount : 0;
  const falseConfidentRate = n ? falseConfident / n : 0;
  const missedAbstentionRate = unrecoverableCount ? missedAbstention / unrecoverableCount : 0;
  const correctAbstentionRate = unrecoverableCount ? correctAbstention / unrecoverableCount : 0;

  // Frozen engineering utility (blueprint §9): reward coverage, punish danger.
  const utility = validCoverage - 5 * falseConfidentRate - 2 * missedAbstentionRate;

  return {
    statistician_version: STATISTICIAN_VERSION,
    error_tolerance_bpm: errorTolerance,
    n_trials: n,
    n_recoverable: recoverableCount,
    n_unrecoverable: unrecoverableCount,
    mae_bpm: round(mae),
    p95_error_bpm: round(p95),
    valid_coverage: round(validCoverage),
    false_confident_rate: round(falseConfidentRate),
    missed_abstention_rate: round(missedAbstentionRate),
    correct_abstention_rate: round(correctAbstentionRate),
    utility: round(utility),
  };
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor(p * s.length));
  return s[idx];
}

function round(x, d = 4) {
  if (x === null || x === undefined) return null;
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
