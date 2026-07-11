// World A — stationary sinusoidal respiration.
//
// The simplest causal model: a fixed-frequency fundamental + a small second
// harmonic, plus cardiac, baseline wander and sensor noise. This is the world a
// naive spectral or template estimator is implicitly tuned for — which is why
// passing HERE alone must never advance a claim (see the cross-world quorum).

import { createRng } from '../rng.mjs';
import { respScenario, nSamples, makeTrial } from './common.mjs';

export const family = 'sinusoidal';
export const version = '1.0.0';

export function generate(seed) {
  const s = respScenario(seed);
  const rng = createRng((s.seed ^ 0x9e3779b9) >>> 0);
  const n = nSamples(s);
  const fr = s.true_rr_bpm / 60;
  const fc = s.true_hr_bpm / 60;
  const phase = rng.range(0, Math.PI * 2);
  const h2 = rng.range(0.05, 0.25);
  const wanderF = rng.range(0.005, 0.02);
  const displacement = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / s.fs_hz;
    displacement[i] =
      s.resp_amplitude * Math.sin(2 * Math.PI * fr * t + phase) +
      s.resp_amplitude * h2 * Math.sin(2 * Math.PI * 2 * fr * t + phase) +
      s.cardiac_amplitude * Math.sin(2 * Math.PI * fc * t) +
      s.baseline_wander * Math.sin(2 * Math.PI * wanderF * t + 0.7) +
      rng.gaussian(0, s.sensor_noise_sd);
  }
  return makeTrial({ family, version, displacement, scenario: s, trueRr: s.true_rr_bpm });
}
