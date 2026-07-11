// Preregistration (blueprint §4, extended for cross-world experiments).
//
// Before an experiment runs, the designer freezes a protocol: the hypothesis,
// the exact world + challenge set + seed range (hashed), the candidate vs
// baseline estimators, the primary metric, the acceptance thresholds, and the
// failure conditions. The protocol is hashed BEFORE the executor derives hidden
// ground truth. Thresholds cannot be edited after results without breaking the
// freeze hash (`protocolIntact`).

import { sha256, shortHash } from './hash.mjs';
import { worldVersion } from './simulators/index.mjs';

export const PROTOCOL_VERSION = '2.0.0';

const UNIVERSAL_FAILURE_CONDITIONS = [
  'threshold_modified_after_execution',
  'ground_truth_visible_to_estimator',
  'test_subject_used_during_training',
  'evidence_from_single_simulator_family',
];

export function buildDatasetManifest(spec) {
  return {
    simulator_world: spec.world_family,
    world_version: worldVersion(spec.world_family),
    challenge_set: spec.challenge_set,
    provenance_class: spec.provenance_class || 'simulated',
    seed_start: spec.seed_start,
    seed_count: spec.seed_count,
    channels_exposed: ['displacement', 'imu'],
  };
}

export function preregister(spec, meta = {}) {
  const dataset = buildDatasetManifest(spec);
  const datasetHash = sha256(dataset);

  const experimentId = `EXP-${spec.claim_id.replace(/^CLM-/, '')}-${shortHash({
    step: spec.step_id,
    world: spec.world_family,
    challenge: spec.challenge_set,
    candidate: spec.candidate,
    dataset: datasetHash,
  })}`;

  const protocolBody = {
    protocol_version: PROTOCOL_VERSION,
    experiment_id: experimentId,
    claim_id: spec.claim_id,
    step_id: spec.step_id,
    tier: spec.advance_to ?? null,
    advance_to: spec.advance_to ?? null,
    hypothesis: spec.hypothesis,
    world_family: spec.world_family,
    challenge_set: spec.challenge_set,
    provenance_class: spec.provenance_class || 'simulated',
    dataset: { frozen_manifest_hash: datasetHash, manifest: dataset },
    comparison: { candidate: spec.candidate, baseline: spec.baseline },
    primary_metric: 'respiratory_rate_mae_bpm',
    acceptance: {
      mae_max: spec.acceptance.mae_max ?? null,
      coverage_min: spec.acceptance.coverage_min ?? null,
      false_confident_max: spec.acceptance.false_confident_max ?? null,
      missed_abstention_max: spec.acceptance.missed_abstention_max ?? null,
      target_absent_fp_max: spec.acceptance.target_absent_fp_max ?? null,
      utility_min: spec.acceptance.utility_min ?? null,
    },
    failure_conditions: UNIVERSAL_FAILURE_CONDITIONS.slice(),
    seed_start: spec.seed_start,
    seed_count: spec.seed_count,
  };

  const protocolHash = sha256(protocolBody);
  return {
    ...protocolBody,
    protocol_hash: protocolHash,
    acceptance_criteria_frozen: true,
    preregistered_at: meta.now ?? new Date().toISOString(),
    status: 'preregistered',
  };
}

export function protocolIntact(protocol) {
  const body = { ...protocol };
  delete body.protocol_hash;
  delete body.acceptance_criteria_frozen;
  delete body.preregistered_at;
  delete body.status;
  return sha256(body) === protocol.protocol_hash;
}
