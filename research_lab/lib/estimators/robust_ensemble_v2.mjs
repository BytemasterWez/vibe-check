// Robust abstaining ensemble, v2 — adds an upstream multi-target ambiguity gate.
//
// This is a NEW candidate version, not an edit to v1's frozen result. The
// pipeline follows the safer decomposition from the review:
//   target/attribution validity  ->  ambiguity check  ->  rate estimation
//   ->  cross-method agreement    ->  abstention
//
// The lesson of RR-004 is that two algorithmically independent methods agreeing
// on the same mixed input is not enough (mathematical independence != informa-
// tional independence). v2 first asks whether the observation is attributable to
// a single target — using the second spatial channel — and abstains when it is
// not, BEFORE trusting any rate the members agree on.

import { adaptive_motion_cancellation_v2 } from './adaptive_motion_cancellation.mjs';
import { autocorr_v1 } from './autocorr.mjs';
import { detectAmbiguity } from '../detectors/ambiguity.mjs';
import { loadEnsembleConfig } from './ensemble_config.mjs';
import { imuCancel } from '../dsp.mjs';

export const ENSEMBLE_V2_FAMILY = 'ensemble';

export function robust_ensemble_v2(input, params = {}) {
  const cfg = loadEnsembleConfig();
  const stamp = { estimator: 'robust_ensemble_v2', ensemble_version: cfg.ensemble_version, config_hash: cfg.config_hash };

  // Stage 1 — attribution/ambiguity gate (observational independence). Run it on
  // IMU-cancelled channels so IMU-observable apparatus motion is removed first
  // and cannot masquerade as a second target; a second person (not on the IMU)
  // survives cancellation and still trips the detector.
  const imu = input.channels.imu;
  const cancelledInput = {
    ...input,
    channels: {
      displacement: imuCancel(input.channels.displacement, imu),
      displacement_b: imuCancel(input.channels.displacement_b || input.channels.displacement, imu),
      imu,
    },
  };
  const amb = detectAmbiguity(cancelledInput, params);
  if (amb.ambiguous) {
    return { ...stamp, abstained: true, rr_bpm: null, reason: 'multi_target_ambiguity', ambiguity: amb };
  }

  // Stage 2 — algorithmically independent members must both commit and agree.
  const spectral = adaptive_motion_cancellation_v2(input, params);
  const auto = autocorr_v1(input, params);
  if (spectral.abstained || auto.abstained) {
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
  if (disagreement > cfg.agreement_tolerance_bpm) {
    return { ...stamp, abstained: true, rr_bpm: null, reason: 'methods_disagree', disagreement_bpm: disagreement };
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
