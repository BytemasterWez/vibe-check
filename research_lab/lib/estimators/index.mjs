// Estimator registry (build-packet §1).
//
// Independently implemented candidate estimators. Independence is the point: if
// one estimator secretly shares the simulator's assumptions it can pass a world
// it should fail. The selector chooses experiments that DISTINGUISH these, and
// the cross-world quorum refuses to advance a claim whose only support comes
// from a single world family.
//
// Estimators receive ONLY readable channels — never ground truth. Each returns
//   { estimator, abstained, rr_bpm|null, sqi, ... }.

import { fft_peak_v1, FFT_PEAK_FAMILY } from './fft_peak.mjs';
import { autocorr_v1, AUTOCORR_FAMILY } from './autocorr.mjs';
import { adaptive_motion_cancellation_v2, AMC_FAMILY } from './adaptive_motion_cancellation.mjs';
import { robust_ensemble_v1, ENSEMBLE_FAMILY } from './robust_ensemble.mjs';
import { robust_ensemble_v2, ENSEMBLE_V2_FAMILY } from './robust_ensemble_v2.mjs';
import { sinusoid_template_v1, TEMPLATE_FAMILY } from './sinusoid_template.mjs';

export const ESTIMATORS = {
  fft_peak_v1,
  autocorr_v1,
  adaptive_motion_cancellation_v2,
  robust_ensemble_v1,
  robust_ensemble_v2,
  sinusoid_template_v1,
};

// Which structural family each estimator belongs to (for diversity reporting and
// for choosing genuinely different candidate/baseline pairs).
export const ESTIMATOR_FAMILIES = {
  fft_peak_v1: FFT_PEAK_FAMILY,
  autocorr_v1: AUTOCORR_FAMILY,
  adaptive_motion_cancellation_v2: AMC_FAMILY,
  robust_ensemble_v1: ENSEMBLE_FAMILY,
  robust_ensemble_v2: ENSEMBLE_V2_FAMILY,
  sinusoid_template_v1: TEMPLATE_FAMILY,
};

export function runEstimator(name, input, params) {
  const fn = ESTIMATORS[name];
  if (!fn) throw new Error(`unknown estimator: ${name}`);
  // Hand the estimator ONLY readable channels — strip ground truth defensively.
  const safeInput = {
    channels: {
      displacement: input.channels.displacement,
      displacement_b: input.channels.displacement_b,
      imu: input.channels.imu,
    },
    fs_hz: input.fs_hz,
    duration_s: input.duration_s,
  };
  return fn(safeInput, params || {});
}
