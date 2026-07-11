// Shared scaffolding for the respiratory world generators. Each generator draws
// a physiological scenario, synthesizes a displacement channel from a
// STRUCTURALLY DIFFERENT model, and returns the same trial shape with a hidden
// ground-truth block. Keeping the scenario draw shared (rate range, noise) while
// the waveform model differs is deliberate: it isolates "does the estimator
// generalize across signal STRUCTURE" from incidental parameter differences.

import { createRng } from '../rng.mjs';

export const FS_HZ = 20;
export const DURATION_S = 60;

// A second spatial observation (a different range bin / antenna). For a single
// source it is a gain-scaled copy of the primary channel plus independent noise,
// so the two channels agree on the dominant rhythm. A second target that mixes
// into the two channels with DIFFERENT relative weights makes them disagree —
// which is the observational independence a multi-target ambiguity detector
// needs, and which two methods on the SAME channel cannot supply.
function secondChannel(displacement, scenario) {
  const rng = createRng((scenario.seed ^ 0x85ebca6b) >>> 0);
  const gainB = 0.6 + 0.3 * ((scenario.seed % 7) / 7); // 0.6..0.9, source-consistent
  const noiseSd = scenario.sensor_noise_sd ?? 0.05;
  return displacement.map((v) => gainB * v + rng.gaussian(0, noiseSd));
}

export function respScenario(seed) {
  const rng = createRng(seed >>> 0);
  return {
    seed: seed >>> 0,
    fs_hz: FS_HZ,
    duration_s: DURATION_S,
    true_rr_bpm: rng.range(8, 30), // the claim-relevant operating range
    true_hr_bpm: rng.range(50, 100),
    resp_amplitude: rng.range(0.6, 1.2),
    cardiac_amplitude: rng.range(0.02, 0.08),
    baseline_wander: rng.range(0.05, 0.2),
    sensor_noise_sd: rng.range(0.02, 0.12),
  };
}

export function nSamples(s = { fs_hz: FS_HZ, duration_s: DURATION_S }) {
  return Math.round(s.fs_hz * s.duration_s);
}

// A respiratory trial in the canonical shape every generator emits.
export function makeTrial({ family, version, displacement, imu, scenario, trueRr }) {
  return {
    generator: family,
    generator_version: version,
    world_family: family,
    channels: {
      displacement,
      displacement_b: secondChannel(displacement, scenario),
      imu: imu ?? new Array(displacement.length).fill(0),
    },
    fs_hz: scenario.fs_hz,
    duration_s: scenario.duration_s,
    ground_truth: {
      true_rr_bpm: trueRr,
      target_present: true,
      recoverable: true,
      scenario,
    },
  };
}
