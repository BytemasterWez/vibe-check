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
import { loadEnsembleConfig } from './ensemble_config.mjs';

export const ENSEMBLE_FAMILY = 'ensemble';

const MEMBER_FNS = {
  adaptive_motion_cancellation_v2,
  autocorr_v1,
};

export function robust_ensemble_v1(input, params = {}) {
  const cfg = loadEnsembleConfig();
  const agreeTol = cfg.agreement_tolerance_bpm;
  const [m0, m1] = cfg.members.map((name) => MEMBER_FNS[name]);
  const spectral = m0(input, params);
  const auto = m1(input, params);

  const stamp = { estimator: 'robust_ensemble_v1', ensemble_version: cfg.ensemble_version, config_hash: cfg.config_hash };

  // Abstain unless BOTH independent methods commit to a number.
  if (cfg.abstain_if_any_member_abstains && (spectral.abstained || auto.abstained)) {
    return {
      ...stamp,
      abstained: true,
      rr_bpm: null,
      reason: spectral.abstained && auto.abstained ? 'both_abstained' : 'one_method_abstained',
      spectral_rr: spectral.rr_bpm,
      autocorr_rr: auto.rr_bpm,
    };
  }

  const disagreement = Math.abs(spectral.rr_bpm - auto.rr_bpm);
  if (cfg.abstain_on_disagreement && disagreement > agreeTol) {
    // Independent methods disagree => the signal is not trustworthy; abstain.
    return {
      ...stamp,
      abstained: true,
      rr_bpm: null,
      reason: 'methods_disagree',
      disagreement_bpm: disagreement,
      spectral_rr: spectral.rr_bpm,
      autocorr_rr: auto.rr_bpm,
    };
  }

  return {
    ...stamp,
    abstained: false,
    rr_bpm: (spectral.rr_bpm + auto.rr_bpm) / 2,
    agreement_bpm: disagreement,
    spectral_rr: spectral.rr_bpm,
    autocorr_rr: auto.rr_bpm,
  };
}
