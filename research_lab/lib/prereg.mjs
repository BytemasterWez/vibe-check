// Preregistration (blueprint §4).
//
// Before an experiment runs, the designer freezes a protocol: the hypothesis,
// the exact dataset (a manifest of simulator config + seeds, hashed), the
// candidate vs baseline, the primary metric, the acceptance thresholds, and the
// failure conditions that would invalidate the run. The protocol is hashed
// BEFORE the executor generates hidden ground truth. Results can never
// retroactively change the test — the Protocol Auditor forbids threshold edits
// after execution, and the reproducer recomputes from this frozen record.

import { sha256, shortHash } from './hash.mjs';

export const PROTOCOL_VERSION = '1.0.0';

// Non-negotiable failure conditions attached to every protocol.
const UNIVERSAL_FAILURE_CONDITIONS = [
  'threshold_modified_after_execution',
  'ground_truth_visible_to_estimator',
  'test_subject_used_during_training',
];

// Build the frozen dataset manifest for an experiment. It fully determines the
// data the estimator will see, so hashing it pins the inputs.
export function buildDatasetManifest(spec) {
  return {
    simulator_a_version: '1.0.0',
    simulator_b_version: spec.perturbations.length ? '1.0.0' : null,
    perturbations: spec.perturbations,
    perturbation_salt: spec.perturbation_salt ?? 7,
    seeds: spec.seeds,
    channels_exposed: ['displacement', 'imu'],
  };
}

export function preregister(spec, meta = {}) {
  const dataset = buildDatasetManifest(spec);
  const datasetHash = sha256(dataset);

  const experimentId = `EXP-${spec.claim_id.replace(/^CLM-/, '')}-${shortHash({
    family: spec.family,
    candidate: spec.candidate,
    dataset: datasetHash,
  })}`;

  // The protocol body — everything that must be frozen. Ground truth is NOT
  // here; the executor derives it from seeds after this is hashed.
  const protocolBody = {
    protocol_version: PROTOCOL_VERSION,
    experiment_id: experimentId,
    claim_id: spec.claim_id,
    family: spec.family,
    advance_to: spec.advance_to ?? null,
    hypothesis: spec.hypothesis,
    dataset: {
      source: spec.perturbations.length ? 'synthetic_adversarial_v1' : 'synthetic_mechanistic_v1',
      frozen_manifest_hash: datasetHash,
      manifest: dataset,
    },
    comparison: {
      candidate: spec.candidate,
      baseline: spec.baseline,
    },
    primary_metric: 'respiratory_rate_mae_bpm',
    acceptance: {
      mae_max: spec.acceptance.mae_max,
      coverage_min: spec.acceptance.coverage_min,
      false_confident_max: spec.acceptance.false_confident_max,
      utility_min: spec.acceptance.utility_min ?? null,
    },
    failure_conditions: UNIVERSAL_FAILURE_CONDITIONS.slice(),
    seeds: spec.seeds,
  };

  // The freeze hash covers the protocol body verbatim.
  const protocolHash = sha256(protocolBody);

  return {
    ...protocolBody,
    protocol_hash: protocolHash,
    acceptance_criteria_frozen: true,
    preregistered_at: meta.now ?? new Date().toISOString(),
    status: 'preregistered',
  };
}

// The Protocol Auditor's guard: confirm nobody edited a frozen protocol.
export function protocolIntact(protocol) {
  const body = { ...protocol };
  delete body.protocol_hash;
  delete body.acceptance_criteria_frozen;
  delete body.preregistered_at;
  delete body.status;
  return sha256(body) === protocol.protocol_hash;
}
