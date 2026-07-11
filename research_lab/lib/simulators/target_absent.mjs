// World D — target absent.
//
// No breathing subject in range: only sensor noise, baseline wander and faint
// broadband environmental motion. There is NO respiratory rate to recover; the
// only correct behaviour is to abstain. Confident output here is the most
// dangerous failure class (a monitor inventing a vital sign on an empty scene),
// so this world backs both CLM-RR-003 and the hard TargetAbsentFalsePositive
// constraint, which is why campaigns run it at high trial counts.

import { createRng } from '../rng.mjs';
import { FS_HZ, DURATION_S, nSamples, makeTrial } from './common.mjs';

export const family = 'target_absent';
export const version = '1.0.0';

export function generate(seed) {
  const rng = createRng((seed ^ 0x27d4eb2f) >>> 0);
  const scenario = {
    seed: seed >>> 0,
    fs_hz: FS_HZ,
    duration_s: DURATION_S,
    true_rr_bpm: null,
    resp_amplitude: 0,
    sensor_noise_sd: rng.range(0.05, 0.2),
    baseline_wander: rng.range(0.05, 0.25),
  };
  const n = nSamples(scenario);
  const wanderF = rng.range(0.004, 0.02);
  const displacement = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / scenario.fs_hz;
    displacement[i] =
      scenario.baseline_wander * Math.sin(2 * Math.PI * wanderF * t + rng.range(0, 1)) * 0.3 +
      rng.gaussian(0, scenario.sensor_noise_sd);
  }
  const trial = makeTrial({ family, version, displacement, scenario, trueRr: null });
  trial.ground_truth.target_present = false;
  trial.ground_truth.recoverable = false; // nothing to recover; must abstain
  return trial;
}
