// Blind challenge sets (build-packet §3).
//
// A challenge set names a family of hidden scenarios. The experiment designer
// (selector) may reference a set by id and coarse metadata ONLY — it cannot see
// the per-trial perturbation schedule or the truth annotations. The executor is
// the sole reader of `resolveChallengeManifest`, and the estimator only ever
// receives the observation stream (channels). Truth is revealed to the
// statistician at scoring time. This split is enforced by which module imports
// which export: selector imports CHALLENGE_PUBLIC; executor imports the resolver.

import { RESPIRATORY_WORLDS, NULL_WORLDS } from './simulators/index.mjs';

// --- Public metadata the selector is allowed to see ------------------------
export const CHALLENGE_PUBLIC = {
  clean: { id: 'clean', tier: 'C3', difficulty: 'baseline', worlds: RESPIRATORY_WORLDS },
  motion: { id: 'motion', tier: 'C4', difficulty: 'adversarial', worlds: RESPIRATORY_WORLDS },
  intruder: { id: 'intruder', tier: 'C4', difficulty: 'adversarial', worlds: RESPIRATORY_WORLDS },
  intruder_distinct: { id: 'intruder_distinct', tier: 'C4', difficulty: 'adversarial', worlds: RESPIRATORY_WORLDS },
  target_absent: { id: 'target_absent', tier: 'C4', difficulty: 'null', worlds: NULL_WORLDS },
};

// --- Hidden manifests, readable only by the executor -----------------------
// A schedule is a per-seed rotation of perturbation lists (empty == untouched).
const CHALLENGE_HIDDEN = {
  clean: { perturbation_schedule: [], salt: 7 },
  // Periodic apparatus motion >= respiratory displacement, IMU-observable.
  motion: { perturbation_schedule: [['device_motion']], salt: 1337 },
  // A second independently-breathing subject, NOT on the IMU (ambiguous).
  intruder: { perturbation_schedule: [['second_person']], salt: 55 },
  // A second subject at a distinct range — spatially separable via the 2nd channel.
  intruder_distinct: { perturbation_schedule: [['second_person_distinct']], salt: 71 },
  target_absent: { perturbation_schedule: [], salt: 4242 },
};

export function challengePublic(id) {
  const c = CHALLENGE_PUBLIC[id];
  if (!c) throw new Error(`unknown challenge set: ${id}`);
  return c;
}

// Executor-only. Intentionally not exported through any selector-facing surface.
export function resolveChallengeManifest(id) {
  const hidden = CHALLENGE_HIDDEN[id];
  if (!hidden) throw new Error(`unknown challenge set: ${id}`);
  return hidden;
}
