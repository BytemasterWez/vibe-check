// Simulator registry (build-packet §2).
//
// Structurally different generative worlds. An estimator must not know which
// world produced a trial, and a claim may not advance on evidence from a single
// world family (see the cross-world quorum). Adding a new world here immediately
// widens the coverage the diversity report and the quorum demand.

import * as sinusoidal from './sinusoidal.mjs';
import * as nonstationary from './nonstationary.mjs';
import * as biomechanical from './biomechanical.mjs';
import * as targetAbsent from './target_absent.mjs';

const MODULES = [sinusoidal, nonstationary, biomechanical, targetAbsent];

export const SIMULATORS = Object.fromEntries(MODULES.map((m) => [m.family, m]));

// Worlds that contain a recoverable respiratory rate (target present).
export const RESPIRATORY_WORLDS = ['sinusoidal', 'nonstationary', 'biomechanical'];
// Worlds with no target — abstention-only, used for the target-absent constraint.
export const NULL_WORLDS = ['target_absent'];

export const ALL_WORLDS = MODULES.map((m) => m.family);

export function worldVersion(family) {
  const m = SIMULATORS[family];
  if (!m) throw new Error(`unknown simulator world: ${family}`);
  return m.version;
}

export function generateWorld(family, seed) {
  const m = SIMULATORS[family];
  if (!m) throw new Error(`unknown simulator world: ${family}`);
  return m.generate(seed);
}
