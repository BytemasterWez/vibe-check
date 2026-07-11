// Sinusoid-template estimator — DELIBERATELY OVERFIT to the stationary
// sinusoidal world, and NEVER abstains. It matched-filters the signal against
// pure single-tone templates and reports the best-matching frequency, always
// with confidence. On clean sinusoids it is near-perfect. On a non-stationary
// or biomechanical world its single-tone assumption is wrong, and because it
// never abstains it emits confident errors; on an empty (target-absent) scene it
// invents a rate. It exists so the laboratory can DEMONSTRATE that it exposes
// and rejects an estimator that is brilliant on one world and dangerous on
// others — the self-consistency failure the cross-world quorum and the hard
// safety constraints are built to catch. Do not use it as a real candidate.

import { detrend } from '../dsp.mjs';

export const TEMPLATE_FAMILY = 'template';

export function sinusoid_template_v1(input, params = {}) {
  const fs = input.fs_hz;
  const x = detrend(input.channels.displacement);
  const n = x.length;
  const band = [0.1, 0.7];
  const bins = 120;

  // Correlate against pure sine/cosine templates; pick the best-matching tone.
  let bestF = band[0];
  let bestScore = -Infinity;
  for (let b = 0; b < bins; b++) {
    const f = band[0] + ((band[1] - band[0]) * b) / (bins - 1);
    const w = (2 * Math.PI * f) / fs;
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      re += x[i] * Math.cos(w * i);
      im -= x[i] * Math.sin(w * i);
    }
    const score = re * re + im * im;
    if (score > bestScore) {
      bestScore = score;
      bestF = f;
    }
  }

  // By construction: full confidence, always. No SQI gate, no ambiguity gate,
  // no target-presence gate. This is the dangerous behaviour under test.
  return {
    estimator: 'sinusoid_template_v1',
    abstained: false,
    rr_bpm: bestF * 60,
    sqi: null,
    band_peak_hz: bestF,
    overconfident_by_design: true,
  };
}
