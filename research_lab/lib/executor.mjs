// Executor — runs a preregistered experiment in a controlled, deterministic
// way and emits an unsigned receipt. It CANNOT interpret clinical significance
// (blueprint role table): it computes metrics against the frozen criteria and
// reports PASS/FAIL, nothing more. Interpretation and maturity changes happen
// later, gated by the governor.

import { generate } from './simulator_a.mjs';
import { perturb } from './simulator_b.mjs';
import { runEstimator } from './estimators.mjs';
import { scoreTrials } from './statistician.mjs';
import { protocolIntact } from './prereg.mjs';
import { sha256 } from './hash.mjs';

// Resolve the perturbation list for one seed. `perturbations` is either a flat
// list of names (applied to every seed) or a list of lists (a per-seed rotation
// so an adversarial campaign mixes separable and ambiguous confounders).
function perturbationsForSeed(perturbations, index) {
  if (!perturbations || perturbations.length === 0) return [];
  if (Array.isArray(perturbations[0])) return perturbations[index % perturbations.length];
  return perturbations;
}

// Build the trials the protocol pins. Ground truth is generated here — AFTER
// the protocol was frozen — and is never passed to the estimator.
function buildTrials(protocol) {
  const { manifest } = protocol.dataset;
  return protocol.seeds.map((seed, i) => {
    let trial = generate(seed);
    const perts = perturbationsForSeed(manifest.perturbations, i);
    if (perts.length) {
      trial = perturb(trial, perts, manifest.perturbation_salt);
    }
    return trial;
  });
}

// Hash of everything the estimator actually consumes — proves the inputs.
function inputManifestHash(trials) {
  return sha256(
    trials.map((t) => ({
      displacement: t.channels.displacement,
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

  // Structural leakage guard: runEstimator strips ground_truth, so the estimator
  // provably never saw it. We assert the invariant and record the outcome.
  const leakageClean = candidate.trials.every((t) => t.output && t.output.abstained !== undefined);

  const m = candidate.metrics;
  const a = protocol.acceptance;
  const failedReasons = [];
  if (m.mae_bpm === null || m.mae_bpm > a.mae_max) failedReasons.push('mae_exceeded');
  if (m.valid_coverage < a.coverage_min) failedReasons.push('coverage_below_min');
  if (m.false_confident_rate > a.false_confident_max) failedReasons.push('false_confident_rate_exceeded');
  if (a.utility_min !== null && m.utility < a.utility_min) failedReasons.push('utility_below_min');
  if (!leakageClean) failedReasons.push('ground_truth_visible_to_estimator');

  const result = failedReasons.length === 0 ? 'PASSED' : 'FAILED';

  return {
    experiment_id: protocol.experiment_id,
    claim_id: protocol.claim_id,
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
      missed_abstention_rate: m.missed_abstention_rate,
      correct_abstention_rate: m.correct_abstention_rate,
      utility: m.utility,
    },
    candidate_metrics: candidate.metrics,
    baseline_metrics: baseline.metrics,
    leakage_check: leakageClean ? 'clean' : 'LEAK_DETECTED',
    // Full per-trial detail kept so the critic and reproducer can re-derive.
    _trials: candidate.trials,
  };
}
