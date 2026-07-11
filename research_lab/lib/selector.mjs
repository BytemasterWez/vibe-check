// Experiment Designer / selector (build-packet §1, cross-world).
//
// Picks the next highest-information experiment. It CANNOT execute before
// preregistration (role table) and it is BLIND to hidden challenge manifests —
// it references a challenge set by id and coarse public metadata only. Selection
// walks each claim's evidence plan step by step, running one world at a time, so
// that a claim accrues evidence across independent world families before the
// orchestrator's quorum decides whether it may advance.

import { ALL_WORLDS } from './simulators/index.mjs';
import { challengePublic } from './challenges.mjs';
import { levelIndex } from './maturity.mjs';

// The first plan step a claim has not yet completed (and is not blocked on).
export function currentStep(claim) {
  if (claim.falsified || claim.blocked) return null;
  const steps = claim.evidence_plan?.steps || [];
  const done = new Set(claim.completed_steps || []);
  return steps.find((s) => !done.has(s.id)) || null;
}

function stepReceipts(receipts, claim, step) {
  return receipts.filter((r) => r.claim_id === claim.claim_id && r.step_id === step.id);
}

// Which of a step's worlds already have a receipt for the claim's candidate.
export function worldStatus(receipts, claim, step) {
  const rs = stepReceipts(receipts, claim, step);
  const run = new Set(rs.map((r) => r.world_family));
  return { run, receipts: rs, remaining: step.worlds.filter((w) => !run.has(w)) };
}

function missingWorlds(step) {
  return step.worlds.filter((w) => !ALL_WORLDS.includes(w));
}

// Build the experiment spec for one (claim, step, world).
function buildSpec(claim, step, world) {
  return {
    claim_id: claim.claim_id,
    step_id: step.id,
    advance_to: step.advance_to,
    world_family: world,
    challenge_set: step.challenge_set,
    provenance_class: 'simulated',
    candidate: claim.candidate_estimator,
    baseline: claim.baseline_estimator,
    seed_start: step.seed_start,
    seed_count: step.seed_count,
    acceptance: step.acceptance,
    hypothesis: `Under the '${step.challenge_set}' challenge on the '${world}' world, ${claim.candidate_estimator} satisfies the frozen acceptance for ${claim.claim_id} (${step.advance_to}).`,
  };
}

// Expected-information-gain priority for a claim's next experiment.
function priorityFor(claim, step) {
  const clinicalRelevance = claim.clinical_relevance ?? 1;
  const uncertainty = 1 + (claim.open_uncertainties ? claim.open_uncertainties.length : 0);
  const difficulty = challengePublic(step.challenge_set).difficulty;
  const discriminatingPower = difficulty === 'baseline' ? 0.6 : 1.0;
  const computeCost = Math.max(1, step.seed_count / 120); // ~cost in 120-seed units
  return (clinicalRelevance * uncertainty * discriminatingPower) / computeCost;
}

// One selection decision. Returns an experiment to run, a missing-world signal,
// or null when nothing is runnable (advancement/terminal handled by the loop).
export function selectNext(claims, receipts = []) {
  const experiments = [];
  const missing = [];
  for (const claim of claims) {
    const step = currentStep(claim);
    if (!step) continue;
    const miss = missingWorlds(step);
    if (miss.length) {
      missing.push({ kind: 'missing_world', claim_id: claim.claim_id, step_id: step.id, worlds: miss });
      continue;
    }
    const { remaining } = worldStatus(receipts, claim, step);
    if (!remaining.length) continue; // step fully run — awaiting quorum decision
    experiments.push({ kind: 'experiment', spec: buildSpec(claim, step, remaining[0]), priority: priorityFor(claim, step) });
  }
  experiments.sort((a, b) => b.priority - a.priority);
  if (experiments.length) return experiments[0];
  if (missing.length) return missing[0];
  return null;
}

export function rankAll(claims, receipts = []) {
  const out = [];
  for (const claim of claims) {
    const step = currentStep(claim);
    if (!step) continue;
    if (missingWorlds(step).length) continue;
    const { remaining } = worldStatus(receipts, claim, step);
    for (const world of remaining) {
      out.push({ claim_id: claim.claim_id, step_id: step.id, world, priority: priorityFor(claim, step), spec: buildSpec(claim, step, world) });
    }
  }
  return out.sort((a, b) => b.priority - a.priority);
}

export { levelIndex };
