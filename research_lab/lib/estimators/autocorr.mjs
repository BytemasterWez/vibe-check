// Autocorrelation estimator — a structurally independent method (time-domain
// periodicity, not spectral lines). Finds the respiratory period as the lag of
// the dominant autocorrelation peak in the plausible period range. Shares no
// modelling assumptions with the spectral estimators, so agreement between them
// across worlds is real corroboration rather than shared bias.

import { detrend, highpass, autocorr, zeroFraction } from '../dsp.mjs';

export const AUTOCORR_FAMILY = 'autocorrelation';

export function autocorr_v1(input, params = {}) {
  const acMin = params.ac_min ?? 0.25;
  const fs = input.fs_hz;
  // High-pass away baseline wander (< ~0.08 Hz) so the respiratory oscillation,
  // not a slow ramp, dominates the autocorrelation.
  const x = highpass(detrend(input.channels.displacement), Math.round(fs / 0.08));
  const minLag = Math.floor(fs / 0.7); // fastest respiration ~42 bpm
  const maxLag = Math.floor(fs / 0.1); // slowest ~6 bpm
  const r = autocorr(x, Math.min(maxLag, x.length - 1));

  // First strong local maximum in the period range: prefer the fundamental
  // period over its (taller-enveloped) harmonics by taking the earliest peak
  // that clears the threshold and dominates its neighbours.
  let bestLag = minLag;
  for (let lag = minLag + 1; lag <= maxLag && lag < r.length; lag++) {
    if (r[lag] > r[bestLag]) bestLag = lag;
  }
  let fundLag = bestLag;
  for (let lag = minLag + 1; lag < bestLag && lag + 1 < r.length; lag++) {
    if (r[lag] >= acMin && r[lag] > r[lag - 1] && r[lag] > r[lag + 1] && r[lag] > 0.8 * r[bestLag]) {
      fundLag = lag;
      break;
    }
  }
  const peak = r[fundLag];

  // Abstain only on weak periodicity or heavy dropout. Disambiguation against a
  // competing periodicity (a second breather) is left to the ensemble's
  // cross-method agreement check, which is more reliable than a single method's
  // guess at "how many rhythms are present".
  const dropout = zeroFraction(input.channels.displacement);
  const abstained = peak < acMin || dropout > 0.35;
  return {
    estimator: 'autocorr_v1',
    abstained,
    rr_bpm: abstained ? null : 60 / (fundLag / fs),
    sqi: peak,
    period_lag: fundLag,
    dropout,
  };
}
