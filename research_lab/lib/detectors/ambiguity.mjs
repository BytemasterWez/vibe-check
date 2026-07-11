// Multi-target / ambiguity detector (Packet 3 §10).
//
// The correct response to the RR-004 failure is NOT a better rate estimator: two
// mathematically independent methods can agree confidently on the SAME dominant
// component of a mixed signal and still be attributing the rate to the wrong
// person. This is a separate, upstream check for whether the observation is
// attributable to a single target at all. It uses observational independence —
// a second spatial channel — that a single mixed channel cannot provide.
//
// It flags ambiguity when either:
//   (a) a single channel contains two comparably-strong periodic components, or
//   (b) the two spatial channels disagree on the dominant respiratory frequency
//       (a single source scaled across channels agrees; a two-source mix whose
//        relative weights differ across channels does not).
//
//   detect(input) -> { ambiguous, reasons, components, cross_channel_delta_bpm }

import { detrend, bandPeriodogram, analyzeSpectrum } from '../dsp.mjs';

const RESP_BAND_HZ = [0.1, 0.7];

function spectrum(x, fs) {
  return bandPeriodogram(detrend(x), fs, RESP_BAND_HZ);
}
function dominant(sp) {
  return analyzeSpectrum(sp.freqs, sp.power);
}

// Pearson correlation of two band power spectra. A single source observed in two
// spatial channels is a scaled copy, so the spectra are proportional (corr ~ 1);
// two sources that mix into the channels with different weights change the
// spectral SHAPE, dropping the correlation — this catches harmonic lock-on that
// a dominant-peak-only comparison misses.
function spectralCorr(pa, pb) {
  const n = pa.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += pa[i];
    mb += pb[i];
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = pa[i] - ma;
    const db = pb[i] - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  if (saa === 0 || sbb === 0) return 1;
  return sab / Math.sqrt(saa * sbb);
}

export function detectAmbiguity(input, params = {}) {
  const secondComponentMax = params.second_component_max ?? 0.5; // vs dominant peak
  const crossChannelTolBpm = params.cross_channel_tol_bpm ?? 2.0;
  const minChannelSpectralCorr = params.min_channel_spectral_corr ?? 0.97;
  const fs = input.fs_hz;
  const a = input.channels.displacement;
  const b = input.channels.displacement_b || a;

  const reasons = [];
  const spA = spectrum(a, fs);
  const spB = spectrum(b, fs);
  const specA = dominant(spA);
  const specB = dominant(spB);

  // (a) Two comparable periodic components in the primary channel.
  if (specA.ambiguity > secondComponentMax) {
    reasons.push({ type: 'multiple_periodic_components', ratio: round(specA.ambiguity) });
  }

  // (b) Cross-channel disagreement on the dominant rhythm.
  const deltaBpm = Math.abs(specA.f - specB.f) * 60;
  if (deltaBpm > crossChannelTolBpm) {
    reasons.push({ type: 'cross_channel_source_disagreement', delta_bpm: round(deltaBpm) });
  }

  // (c) Cross-channel spectral-shape divergence (catches harmonic lock-on that a
  //     dominant-peak comparison misses).
  const corr = spectralCorr(spA.power, spB.power);
  if (corr < minChannelSpectralCorr) {
    reasons.push({ type: 'cross_channel_shape_divergence', spectral_corr: round(corr) });
  }

  const components = specA.ambiguity > secondComponentMax ? 2 : 1;
  return {
    ambiguous: reasons.length > 0,
    reasons,
    components,
    cross_channel_delta_bpm: round(deltaBpm),
    channel_spectral_corr: round(corr),
    primary_peak_hz: round(specA.f),
    secondary_peak_ratio: round(specA.ambiguity),
  };
}

function round(x, d = 4) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
