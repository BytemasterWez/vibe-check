// Simulator A — mechanistic signal generator.
//
// Builds a thoracic-displacement-like signal from explicit physiological and
// sensor equations. It knows nothing about the estimator or the acceptance
// criteria; it only emits a signal plus a hidden ground-truth block that the
// estimator never sees (the executor keeps them apart).
//
// Model (deliberately simple, but causal and explicit):
//   displacement(t) = respiratory + cardiac + baseline_wander + sensor_noise
//   respiratory     = A_r * sin(2*pi*f_r*t + phi_r)  [+ 2nd harmonic]
//   cardiac         = A_c * sin(2*pi*f_c*t)           (small, out of resp band)
//   baseline_wander = slow drift (sensor/posture)
//   sensor_noise    = white gaussian at sensor NEP

import { createRng } from './rng.mjs';

export const SIMULATOR_A_VERSION = '1.0.0';

// Draw a plausible trial scenario from a seed. Ranges are physiological.
export function scenarioFromSeed(seed) {
  const rng = createRng(seed >>> 0);
  const rrBpm = rng.range(8, 24); // adult resting-to-elevated respiratory rate
  const hrBpm = rng.range(50, 100);
  return {
    seed: seed >>> 0,
    fs_hz: 20, // sensor sample rate
    duration_s: 60,
    true_rr_bpm: rrBpm,
    true_hr_bpm: hrBpm,
    resp_amplitude: rng.range(0.6, 1.2),
    resp_second_harmonic: rng.range(0.05, 0.25),
    resp_phase: rng.range(0, Math.PI * 2),
    cardiac_amplitude: rng.range(0.02, 0.08),
    baseline_wander: rng.range(0.05, 0.2),
    sensor_noise_sd: rng.range(0.02, 0.12),
  };
}

export function generate(seed) {
  const s = scenarioFromSeed(seed);
  const rng = createRng((s.seed ^ 0x9e3779b9) >>> 0);
  const n = Math.round(s.fs_hz * s.duration_s);
  const fr = s.true_rr_bpm / 60;
  const fc = s.true_hr_bpm / 60;
  const wanderF = rng.range(0.005, 0.02); // very slow drift, below resp band

  const signal = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / s.fs_hz;
    const respiratory =
      s.resp_amplitude * Math.sin(2 * Math.PI * fr * t + s.resp_phase) +
      s.resp_second_harmonic * Math.sin(2 * Math.PI * 2 * fr * t + s.resp_phase);
    const cardiac = s.cardiac_amplitude * Math.sin(2 * Math.PI * fc * t);
    const wander = s.baseline_wander * Math.sin(2 * Math.PI * wanderF * t + 0.7);
    const noise = rng.gaussian(0, s.sensor_noise_sd);
    signal[i] = respiratory + cardiac + wander + noise;
  }

  return {
    generator: 'simulator_a',
    generator_version: SIMULATOR_A_VERSION,
    // Channels the estimator is allowed to read.
    channels: {
      displacement: signal,
      imu: new Array(n).fill(0), // no device motion in Sim A; IMU reads still
    },
    fs_hz: s.fs_hz,
    duration_s: s.duration_s,
    // Hidden ground truth — withheld from the estimator by the executor.
    ground_truth: {
      true_rr_bpm: s.true_rr_bpm,
      recoverable: true, // a clean Sim-A signal is always recoverable
      scenario: s,
    },
  };
}
