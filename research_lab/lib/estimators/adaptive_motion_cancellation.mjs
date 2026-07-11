// Adaptive motion-cancellation estimator (spectral family). Projects the IMU
// channel out of the displacement channel (least-squares) before the spectral
// peak, so IMU-observable apparatus/gross motion is removed and the true
// respiratory peak wins. Motion NOT on the IMU (a second person) still lowers
// SQI / raises ambiguity, which correctly yields abstention rather than a
// confident wrong rate.

import { detrend, bandPeriodogram, analyzeSpectrum, zeroFraction } from '../dsp.mjs';

export const AMC_FAMILY = 'spectral';

export function adaptive_motion_cancellation_v2(input, params = {}) {
  const sqiMin = params.sqi_min ?? 6;
  const ambMax = params.ambiguity_max ?? 0.5;
  const d = detrend(input.channels.displacement);
  const m = detrend(input.channels.imu);

  let mm = 0;
  let dm = 0;
  for (let i = 0; i < d.length; i++) {
    mm += m[i] * m[i];
    dm += d[i] * m[i];
  }
  const g = mm > 1e-9 ? dm / mm : 0;
  const cleaned = d.map((v, i) => v - g * m[i]);

  const { freqs, power } = bandPeriodogram(cleaned, input.fs_hz);
  const peak = analyzeSpectrum(freqs, power);
  const dropout = zeroFraction(input.channels.displacement);
  const abstained = peak.sqi < sqiMin || peak.ambiguity > ambMax || dropout > 0.35;
  return {
    estimator: 'adaptive_motion_cancellation_v2',
    abstained,
    rr_bpm: abstained ? null : peak.f * 60,
    sqi: peak.sqi,
    ambiguity: peak.ambiguity,
    band_peak_hz: peak.f,
    motion_gain: g,
    dropout,
  };
}
