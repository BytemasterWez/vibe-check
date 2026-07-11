// World C — biomechanical chest-wall respiration.
//
// A physiologically-shaped, distinctly NON-sinusoidal breath: asymmetric
// inspiration/expiration synthesized from a small harmonic series with strong
// 2nd/3rd harmonics. The fundamental still dominates (so a robust estimator
// finds the true rate), but a pure-sinusoid template matches poorly and a
// harmonic-naive picker can be pulled toward a harmonic. This is the world that
// most exposes an estimator overfit to clean sinusoids.

import { createRng } from '../rng.mjs';
import { respScenario, nSamples, makeTrial } from './common.mjs';

export const family = 'biomechanical';
export const version = '1.0.0';

// Fixed asymmetric breath shape via a short Fourier series (fundamental largest,
// but heavy harmonic content). Deterministic phases keep it reproducible.
const HARMONICS = [
  { k: 1, a: 1.0, p: 0.0 },
  { k: 2, a: 0.55, p: 0.9 },
  { k: 3, a: 0.32, p: 1.7 },
  { k: 4, a: 0.16, p: 2.4 },
];

export function generate(seed) {
  const s = respScenario(seed);
  const rng = createRng((s.seed ^ 0x2545f491) >>> 0);
  const n = nSamples(s);
  const fr = s.true_rr_bpm / 60;
  const fc = s.true_hr_bpm / 60;
  const wanderF = rng.range(0.005, 0.02);
  const phase0 = rng.range(0, Math.PI * 2);
  const displacement = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / s.fs_hz;
    const phi = 2 * Math.PI * fr * t + phase0;
    let breath = 0;
    for (const h of HARMONICS) breath += h.a * Math.sin(h.k * phi + h.p);
    displacement[i] =
      s.resp_amplitude * 0.6 * breath +
      s.cardiac_amplitude * Math.sin(2 * Math.PI * fc * t) +
      s.baseline_wander * Math.sin(2 * Math.PI * wanderF * t + 0.7) +
      rng.gaussian(0, s.sensor_noise_sd);
  }
  return makeTrial({ family, version, displacement, scenario: s, trueRr: s.true_rr_bpm });
}
