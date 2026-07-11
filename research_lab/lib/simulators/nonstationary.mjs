// World B — non-stationary respiration.
//
// The instantaneous respiratory frequency drifts over the window (a slow random
// walk) and the amplitude is modulated. Structurally different from a stationary
// sinusoid: energy is smeared across a range of frequencies rather than a single
// line. A frequency-matched template tuned on stationary data degrades here; a
// robust estimator should still recover the MEAN rate (the claim's target).

import { createRng } from '../rng.mjs';
import { respScenario, nSamples, makeTrial } from './common.mjs';

export const family = 'nonstationary';
export const version = '1.0.0';

export function generate(seed) {
  const s = respScenario(seed);
  const rng = createRng((s.seed ^ 0x51ed270b) >>> 0);
  const n = nSamples(s);
  const f0 = s.true_rr_bpm / 60;
  const fc = s.true_hr_bpm / 60;
  const wanderF = rng.range(0.005, 0.02);

  // Slow bounded random walk on instantaneous frequency (±15%).
  const inst = new Array(n);
  let dev = 0;
  for (let i = 0; i < n; i++) {
    dev += rng.gaussian(0, 0.0015);
    dev = Math.max(-0.15, Math.min(0.15, dev));
    inst[i] = f0 * (1 + dev);
  }

  const displacement = new Array(n);
  let phase = rng.range(0, Math.PI * 2);
  let sumF = 0;
  for (let i = 0; i < n; i++) {
    const t = i / s.fs_hz;
    phase += (2 * Math.PI * inst[i]) / s.fs_hz;
    sumF += inst[i];
    const am = 1 + 0.25 * Math.sin(2 * Math.PI * 0.03 * t); // amplitude modulation
    displacement[i] =
      s.resp_amplitude * am * Math.sin(phase) +
      s.cardiac_amplitude * Math.sin(2 * Math.PI * fc * t) +
      s.baseline_wander * Math.sin(2 * Math.PI * wanderF * t + 0.7) +
      rng.gaussian(0, s.sensor_noise_sd);
  }
  // The claim targets the mean rate over the window.
  const trueRr = (sumF / n) * 60;
  return makeTrial({ family, version, displacement, scenario: s, trueRr });
}
