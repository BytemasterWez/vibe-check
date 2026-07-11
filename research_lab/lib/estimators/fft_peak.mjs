// Spectral peak estimator. Detrend, band periodogram, take the dominant peak,
// convert to bpm. Abstains on weak (low SQI), ambiguous (competing peak) or
// dropout-heavy signals. Harmonic-aware: if the dominant peak looks like the 2nd
// harmonic of a strong sub-harmonic, it prefers the fundamental — so it is not
// fooled by the biomechanical world's harmonic content.

import { detrend, bandPeriodogram, analyzeSpectrum, zeroFraction } from '../dsp.mjs';

export const FFT_PEAK_FAMILY = 'spectral';

function powerAt(freqs, power, f) {
  let bi = 0;
  for (let i = 1; i < freqs.length; i++) if (Math.abs(freqs[i] - f) < Math.abs(freqs[bi] - f)) bi = i;
  return power[bi];
}

export function fft_peak_v1(input, params = {}) {
  const sqiMin = params.sqi_min ?? 6;
  const ambMax = params.ambiguity_max ?? 0.5;
  const x = detrend(input.channels.displacement);
  const { freqs, power } = bandPeriodogram(x, input.fs_hz);
  const peak = analyzeSpectrum(freqs, power);

  // Harmonic guard: if half the peak frequency is in band and carries
  // comparable power, the true fundamental is the sub-harmonic.
  let f = peak.f;
  const half = peak.f / 2;
  if (half >= 0.1 && powerAt(freqs, power, half) > 0.5 * peak.power) f = half;

  const dropout = zeroFraction(input.channels.displacement);
  const abstained = peak.sqi < sqiMin || peak.ambiguity > ambMax || dropout > 0.35;
  return {
    estimator: 'fft_peak_v1',
    abstained,
    rr_bpm: abstained ? null : f * 60,
    sqi: peak.sqi,
    ambiguity: peak.ambiguity,
    band_peak_hz: peak.f,
    dropout,
  };
}
