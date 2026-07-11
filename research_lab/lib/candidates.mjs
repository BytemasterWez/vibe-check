// Co-equal multi-candidate evaluation (Packet 3 §1).
//
// The ensemble gets no special status — it is evaluated as one candidate among
// several, on the same worlds and challenges, with the same frozen scoring. This
// exposes where each method wins or loses and, critically, the PAIRWISE
// DISAGREEMENT between methods: two methods that rarely disagree may merely share
// assumptions (mathematical vs informational independence).

import { generateWorld } from './simulators/index.mjs';
import { perturb } from './simulator_b.mjs';
import { resolveChallengeManifest } from './challenges.mjs';
import { runEstimator, ESTIMATOR_FAMILIES } from './estimators/index.mjs';
import { scoreTrials } from './statistician.mjs';

export const DEFAULT_CANDIDATES = ['fft_peak_v1', 'autocorr_v1', 'robust_ensemble_v1', 'robust_ensemble_v2'];

function buildTrials(step, maxSeeds = Infinity) {
  const { perturbation_schedule, salt } = resolveChallengeManifest(step.challenge_set);
  const trials = [];
  const count = Math.min(step.seed_count, maxSeeds);
  for (let i = 0; i < count; i++) {
    let t = generateWorld(step.world, step.seed_start + i);
    if (t.ground_truth.target_present !== false && perturbation_schedule.length) {
      const perts = Array.isArray(perturbation_schedule[0])
        ? perturbation_schedule[i % perturbation_schedule.length]
        : perturbation_schedule;
      if (perts.length) t = perturb(t, perts, salt);
    }
    trials.push(t);
  }
  return trials;
}

function pairwiseDisagreement(outputsByCandidate, tolBpm = 2) {
  const names = Object.keys(outputsByCandidate);
  const pairs = {};
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = outputsByCandidate[names[i]];
      const b = outputsByCandidate[names[j]];
      let both = 0;
      let disagree = 0;
      for (let k = 0; k < a.length; k++) {
        if (!a[k].abstained && !b[k].abstained) {
          both++;
          if (Math.abs(a[k].rr_bpm - b[k].rr_bpm) > tolBpm) disagree++;
        }
      }
      pairs[`${names[i]} vs ${names[j]}`] = { both_committed: both, disagreement_rate: both ? round(disagree / both) : null };
    }
  }
  return pairs;
}

// Evaluate a set of candidates across every (step, world) of a claim.
export function evaluateCandidates(claim, candidates = DEFAULT_CANDIDATES, maxSeeds = 120) {
  const perWorld = [];
  for (const step of claim.evidence_plan.steps) {
    for (const world of step.worlds) {
      const trials = buildTrials({ ...step, world }, maxSeeds);
      const outputs = {};
      const cells = {};
      for (const cand of candidates) {
        const outs = trials.map((t) => runEstimator(cand, t, {}));
        outputs[cand] = outs;
        const m = scoreTrials(outs.map((o, k) => ({ output: o, ground_truth: trials[k].ground_truth })));
        cells[cand] = {
          mae_bpm: m.mae_bpm,
          coverage: m.valid_coverage,
          abstention_rate: round(1 - (m.n_recoverable ? m.valid_coverage : 0)),
          false_confident_rate: m.false_confident_rate,
          target_absent_fp_rate: m.target_absent_false_positive_rate,
          p95_error_bpm: m.p95_error_bpm,
        };
      }
      perWorld.push({
        step: step.id,
        challenge: step.challenge_set,
        world,
        candidates: cells,
        pairwise_disagreement: pairwiseDisagreement(outputs),
      });
    }
  }
  return {
    claim_id: claim.claim_id,
    candidates: candidates.map((c) => ({ name: c, family: ESTIMATOR_FAMILIES[c] })),
    per_world: perWorld,
  };
}

function round(x, d = 4) {
  if (x === null || x === undefined) return null;
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
