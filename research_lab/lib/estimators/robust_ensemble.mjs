// Robust abstaining ensemble — the qualifying candidate.
//
// It combines two STRUCTURALLY INDEPENDENT estimators — an IMU-cancelling
// spectral estimator and a time-domain autocorrelation estimator — and reports
// a rate ONLY when both produce a number AND they agree within tolerance.
// Otherwise it abstains. This is the concrete answer to the self-consistency
// problem: a rate survives only when methods that do not share assumptions
// corroborate each other, so a single method's blind spot cannot produce a
// confident output. It is conservative by construction, which is exactly what a
// clinical measurement should be.

import { adaptive_motion_cancellation_v2 } from './adaptive_motion_cancellation.mjs';
import { autocorr_v1 } from './autocorr.mjs';

export const ENSEMBLE_FAMILY = 'ensemble';

export function robust_ensemble_v1(input, params = {}) {
  const agreeTol = params.agreement_bpm ?? 2.0;
  const spectral = adaptive_motion_cancellation_v2(input, params);
  const auto = autocorr_v1(input, params);

  // Abstain unless BOTH independent methods commit to a number.
  if (spectral.abstained || auto.abstained) {
    return {
      estimator: 'robust_ensemble_v1',
      abstained: true,
      rr_bpm: null,
      reason: spectral.abstained && auto.abstained ? 'both_abstained' : 'one_method_abstained',
      spectral_rr: spectral.rr_bpm,
      autocorr_rr: auto.rr_bpm,
    };
  }

  const disagreement = Math.abs(spectral.rr_bpm - auto.rr_bpm);
  if (disagreement > agreeTol) {
    // Independent methods disagree => the signal is not trustworthy; abstain.
    return {
      estimator: 'robust_ensemble_v1',
      abstained: true,
      rr_bpm: null,
      reason: 'methods_disagree',
      disagreement_bpm: disagreement,
      spectral_rr: spectral.rr_bpm,
      autocorr_rr: auto.rr_bpm,
    };
  }

  return {
    estimator: 'robust_ensemble_v1',
    abstained: false,
    rr_bpm: (spectral.rr_bpm + auto.rr_bpm) / 2,
    agreement_bpm: disagreement,
    spectral_rr: spectral.rr_bpm,
    autocorr_rr: auto.rr_bpm,
  };
}
