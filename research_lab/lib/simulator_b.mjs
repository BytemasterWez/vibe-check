// Simulator B — adversarial perturbation engine.
//
// It does not model biology. It attacks a signal (from Simulator A or, in
// principle, a recording) with named, physically-motivated corruptions. Which
// perturbations were applied is hidden ground truth: the estimator never sees
// it. Each perturbation also updates whether the respiratory rate is still
// *recoverable* — the truth the statistician scores abstention against.
//
// The central design point (blueprint §7, Family C): some corruptions are
// separable given the IMU channel (device_motion, gross_motion) and some are
// genuinely ambiguous (a loud second person, a long dropout). A good estimator
// recovers the former and abstains on the latter.

import { createRng } from './rng.mjs';

export const SIMULATOR_B_VERSION = '1.0.0';

// Deep-ish clone that preserves numeric arrays.
function cloneTrial(trial) {
  return {
    ...trial,
    channels: {
      displacement: trial.channels.displacement.slice(),
      displacement_b: (trial.channels.displacement_b || trial.channels.displacement).slice(),
      imu: trial.channels.imu.slice(),
    },
    ground_truth: {
      ...trial.ground_truth,
      applied_perturbations: [],
      scenario: trial.ground_truth.scenario,
    },
  };
}

const PERTURBATIONS = {
  // Rhythmic apparatus motion near the respiratory band. Separable because the
  // IMU records it — an estimator that cancels IMU-correlated motion recovers
  // the true rate; a naive one may lock onto the device rhythm.
  device_motion(trial, rng) {
    const n = trial.channels.displacement.length;
    const fMotion = rng.range(0.15, 0.6); // Hz, overlaps resp band (9-36 bpm)
    const amp = rng.range(0.8, 1.6) * trial.ground_truth.scenario.resp_amplitude;
    const phase = rng.range(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const t = i / trial.fs_hz;
      const m = amp * Math.sin(2 * Math.PI * fMotion * t + phase);
      trial.channels.displacement[i] += m;
      trial.channels.displacement_b[i] += m; // apparatus motion appears in both bins
      trial.channels.imu[i] += m; // fully observable on the IMU
    }
    // Recoverable: the corrupting motion is measured, so it can be removed.
    return { name: 'device_motion', f_hz: fMotion, recoverable: true };
  },

  // A second breathing person in the field of view, NOT on the IMU. If they
  // breathe nearly as strongly as the subject, attribution is ambiguous and the
  // correct action is to abstain.
  second_person(trial, rng) {
    const n = trial.channels.displacement.length;
    const fOther = rng.range(0.13, 0.45);
    const ratio = rng.range(0.4, 1.1);
    const amp = ratio * trial.ground_truth.scenario.resp_amplitude;
    const phase = rng.range(0, Math.PI * 2);
    // The intruder mixes into the second spatial bin with a DIFFERENT relative
    // weight than the subject does (they are at different ranges), so the two
    // channels disagree on the dominant rhythm when the intruder is strong. This
    // is the spatial/observational information a single mixed channel lacks.
    const gOtherB = rng.range(0.2, 1.6);
    for (let i = 0; i < n; i++) {
      const t = i / trial.fs_hz;
      const s = Math.sin(2 * Math.PI * fOther * t + phase);
      trial.channels.displacement[i] += amp * s;
      trial.channels.displacement_b[i] += amp * gOtherB * s;
    }
    // Ambiguous when the intruder is comparably loud.
    return { name: 'second_person', ratio, f_hz: fOther, gain_b: gOtherB, recoverable: ratio < 0.7 };
  },

  // A second breathing person at a DISTINCT range: loud (unrecoverable by rate
  // alone) but spatially separable, mixing into the two channels with a clearly
  // different weight than the subject. This is the regime where observational
  // independence (a second spatial channel) can catch the intruder and abstain,
  // as opposed to a co-located intruder that no amount of software can separate.
  second_person_distinct(trial, rng) {
    const n = trial.channels.displacement.length;
    const fOther = rng.range(0.13, 0.45);
    const ratio = rng.range(0.7, 1.1); // loud -> not recoverable as a rate
    const amp = ratio * trial.ground_truth.scenario.resp_amplitude;
    const phase = rng.range(0, Math.PI * 2);
    // Spatially distinct: intruder is strongly weighted toward one channel.
    const gOtherB = rng.uniform() < 0.5 ? rng.range(0.05, 0.3) : rng.range(2.2, 3.5);
    for (let i = 0; i < n; i++) {
      const t = i / trial.fs_hz;
      const s = Math.sin(2 * Math.PI * fOther * t + phase);
      trial.channels.displacement[i] += amp * s;
      trial.channels.displacement_b[i] += amp * gOtherB * s;
    }
    return { name: 'second_person_distinct', ratio, f_hz: fOther, gain_b: gOtherB, recoverable: false };
  },

  // Sensor/link dropout: a contiguous run of samples goes to zero. A short gap
  // is recoverable; losing most of the window is not.
  sensor_dropout(trial, rng) {
    const n = trial.channels.displacement.length;
    const frac = rng.range(0.1, 0.6);
    const len = Math.round(frac * n);
    const start = Math.floor(rng.range(0, n - len));
    for (let i = start; i < start + len; i++) {
      trial.channels.displacement[i] = 0;
      trial.channels.displacement_b[i] = 0;
      trial.channels.imu[i] = 0;
    }
    return { name: 'sensor_dropout', fraction: frac, recoverable: frac < 0.4 };
  },

  // Gross transient motion (patient shifts / device knock): large spikes, also
  // seen on the IMU, so an outlier-aware estimator can reject the affected span.
  gross_motion(trial, rng) {
    const n = trial.channels.displacement.length;
    const bursts = Math.floor(rng.range(1, 4));
    for (let b = 0; b < bursts; b++) {
      const at = Math.floor(rng.range(0, n));
      const width = Math.floor(rng.range(2, 8));
      const amp = rng.range(3, 6) * trial.ground_truth.scenario.resp_amplitude;
      for (let i = at; i < Math.min(n, at + width); i++) {
        const spike = amp * (1 - (i - at) / width);
        trial.channels.displacement[i] += spike;
        trial.channels.displacement_b[i] += spike;
        trial.channels.imu[i] += spike;
      }
    }
    return { name: 'gross_motion', bursts, recoverable: true };
  },
};

export const PERTURBATION_NAMES = Object.keys(PERTURBATIONS);

// Apply a named perturbation set to a Sim-A trial. Deterministic in
// (trial seed, perturbation name, salt) so the whole pipeline reproduces.
export function perturb(baseTrial, perturbations, salt = 0) {
  const trial = cloneTrial(baseTrial);
  trial.generator = 'simulator_b';
  trial.generator_version = SIMULATOR_B_VERSION;
  trial.base_generator = baseTrial.generator;

  let recoverable = trial.ground_truth.recoverable;
  perturbations.forEach((name, idx) => {
    const fn = PERTURBATIONS[name];
    if (!fn) throw new Error(`unknown perturbation: ${name}`);
    const seed = (baseTrial.ground_truth.scenario.seed ^ (salt + idx * 0x1000193)) >>> 0;
    const rng = createRng(seed);
    const record = fn(trial, rng);
    trial.ground_truth.applied_perturbations.push(record);
    recoverable = recoverable && record.recoverable;
  });
  trial.ground_truth.recoverable = recoverable;
  return trial;
}
