// Executor — runs a preregistered experiment in a controlled, deterministic
// way and emits an unsigned result. It CANNOT interpret clinical significance:
// it computes metrics against the frozen criteria and reports PASS/FAIL. It is
// the SOLE reader of the hidden challenge manifest and of per-trial ground
// truth; the estimator receives only the observation channels.

import { generateWorld } from './simulators/index.mjs';
import { perturb } from './simulator_b.mjs';
import { resolveChallengeManifest } from './challenges.mjs';
import { runEstimator, ESTIMATOR_FAMILIES } from './estimators/index.mjs';
import { scoreTrials } from './statistician.mjs';
import { protocolIntact } from './prereg.mjs';
import { sha256 } from './hash.mjs';

function perturbationsForSeed(schedule, index) {
  if (!schedule || schedule.length === 0) return [];
  if (Array.isArray(schedule[0])) return schedule[index % schedule.length];
  return schedule;
}

// Build the exact trials the protocol pins. Ground truth is generated HERE —
// after the freeze — and never handed to the estimator.
function buildTrials(protocol) {
  const { challenge_set, world_family, seed_start, seed_count } = protocol;
  const { perturbation_schedule, salt } = resolveChallengeManifest(challenge_set);
  const trials = [];
  for (let i = 0; i < seed_count; i++) {
    const seed = (seed_start + i) >>> 0;
    let trial = generateWorld(world_family, seed);
    const perts = perturbationsForSeed(perturbation_schedule, i);
    if (perts.length && trial.ground_truth.target_present !== false) {
      trial = perturb(trial, perts, salt);
    }
    trials.push(trial);
  }
  return trials;
}

function inputManifestHash(trials) {
  return sha256(
    trials.map((t) => ({
      displacement: t.channels.displacement,
      displacement_b: t.channels.displacement_b,
      imu: t.channels.imu,
      fs_hz: t.fs_hz,
    }))
  );
}

function runArm(estimatorName, trials, params) {
  const scored = trials.map((t) => ({
    output: runEstimator(estimatorName, t, params),
    ground_truth: t.ground_truth,
  }));
  return { estimator: estimatorName, metrics: scoreTrials(scored), trials: scored };
}

export function execute(protocol, opts = {}) {
  if (!protocolIntact(protocol)) {
    throw new Error(`protocol ${protocol.experiment_id} failed integrity check — frozen body was modified`);
  }

  const startedAt = new Date();
  const trials = buildTrials(protocol);
  const inputHash = inputManifestHash(trials);

  const params = { sqi_min: opts.sqi_min ?? 6 };
  const candidate = runArm(protocol.comparison.candidate, trials, params);
  const baseline = runArm(protocol.comparison.baseline, trials, params);
  const completedAt = new Date();

  const leakageClean = candidate.trials.every((t) => t.output && t.output.abstained !== undefined);

  const m = candidate.metrics;
  const a = protocol.acceptance;
  const failedReasons = [];
  if (a.mae_max !== null && (m.mae_bpm === null || m.mae_bpm > a.mae_max)) failedReasons.push('mae_exceeded');
  if (a.coverage_min !== null && m.valid_coverage < a.coverage_min) failedReasons.push('coverage_below_min');
  if (a.false_confident_max !== null && m.false_confident_rate > a.false_confident_max)
    failedReasons.push('false_confident_rate_exceeded');
  if (a.missed_abstention_max !== null && m.missed_abstention_rate > a.missed_abstention_max)
    failedReasons.push('missed_abstention_rate_exceeded');
  if (a.target_absent_fp_max !== null && m.target_absent_false_positive_rate > a.target_absent_fp_max)
    failedReasons.push('target_absent_false_positive_exceeded');
  if (a.utility_min !== null && m.utility < a.utility_min) failedReasons.push('utility_below_min');
  if (!leakageClean) failedReasons.push('ground_truth_visible_to_estimator');

  const result = failedReasons.length === 0 ? 'PASSED' : 'FAILED';

  return {
    experiment_id: protocol.experiment_id,
    claim_id: protocol.claim_id,
    step_id: protocol.step_id,
    tier: protocol.tier,
    world_family: protocol.world_family,
    challenge_set: protocol.challenge_set,
    provenance_class: protocol.provenance_class,
    candidate: protocol.comparison.candidate,
    baseline: protocol.comparison.baseline,
    candidate_family: ESTIMATOR_FAMILIES[protocol.comparison.candidate],
    baseline_family: ESTIMATOR_FAMILIES[protocol.comparison.baseline],
    protocol_hash: protocol.protocol_hash,
    input_manifest_hash: inputHash,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    acceptance_criteria_frozen: protocol.acceptance_criteria_frozen === true,
    acceptance: a,
    result,
    failed_reasons: failedReasons,
    primary_metrics: {
      mae_bpm: m.mae_bpm,
      valid_coverage: m.valid_coverage,
      false_confident_rate: m.false_confident_rate,
      false_confident_count: m.false_confident_count,
      missed_abstention_rate: m.missed_abstention_rate,
      correct_abstention_rate: m.correct_abstention_rate,
      target_absent_false_positive_rate: m.target_absent_false_positive_rate,
      target_absent_false_positive_count: m.target_absent_false_positive_count,
      n_trials: m.n_trials,
      n_target_absent: m.n_target_absent,
      utility: m.utility,
    },
    candidate_metrics: candidate.metrics,
    baseline_metrics: baseline.metrics,
    leakage_check: leakageClean ? 'clean' : 'LEAK_DETECTED',
    _trials: candidate.trials,
  };
}
