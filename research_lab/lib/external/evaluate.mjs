// External-evidence evaluation pipeline (Packet 4 §Track A).
//
// Runs the full gate chain on a recording the lab did not generate and returns
// ONE outcome from a taxonomy that lets external evidence disappoint honestly: a
// perfectly valid dataset can be unsuitable for a claim (it lacks the needed
// spatial information) without that being an estimator failure. It also produces
// an external-evidence receipt binding raw + normalized bytes by hash, and
// records that truth was isolated from the estimator.

import fs from 'fs';
import path from 'path';
import { validateAdapter } from './contract.mjs';
import { checkEligibility, checkSubjectSplit } from './eligibility.mjs';
import { runEstimator } from '../estimators/index.mjs';
import { scoreTrials } from '../statistician.mjs';
import { loadEnsembleConfig } from '../estimators/ensemble_config.mjs';

// Outcomes — PASS/FAIL are not the only valid results.
export const OUTCOMES = [
  'PASS',
  'FAIL',
  'ABSTAIN',
  'EVIDENCE_INELIGIBLE',
  'SIGNAL_TYPE_INCOMPATIBLE',
  'REFERENCE_UNUSABLE',
  'ADAPTER_INVALID',
  'CLAIM_NOT_APPLICABLE',
];

const DISPLACEMENT_SIGNALS = ['chest_displacement', 'radar_phase', 'mmwave_displacement'];

// Is the claim answerable with what this recording physically contains?
function claimApplicability(claim, recording) {
  const needs = claim.required_modalities || [];
  const hasSecondChannel = Array.isArray(recording.input.channels?.displacement_b);
  if ((needs.includes('mmwave_2channel') || needs.includes('spatial_array')) && !hasSecondChannel) {
    return 'the claim needs an independent spatial channel this single-channel recording does not contain';
  }
  return null;
}

// Materialize input and truth to SEPARATE directories, so the estimator can be
// run against an input mount that has no path to the truth mount. This is a
// filesystem boundary (not an OS sandbox), plus an object-level leak check.
function isolateAndRun(recording, estimator, workDir) {
  const inputDir = path.join(workDir, 'runtime', 'input');
  const truthDir = path.join(workDir, 'scorer', 'truth');
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(truthDir, { recursive: true });
  fs.writeFileSync(path.join(inputDir, 'input.json'), JSON.stringify(recording.input));
  fs.writeFileSync(path.join(truthDir, 'truth.json'), JSON.stringify(recording.truth));

  // The estimator only ever reads the input mount.
  const mounted = JSON.parse(fs.readFileSync(path.join(inputDir, 'input.json'), 'utf-8'));
  const ch = mounted.channels;
  const estimatorInput = {
    fs_hz: mounted.fs_hz,
    channels: {
      displacement: ch.displacement,
      displacement_b: ch.displacement_b || ch.displacement,
      imu: ch.imu || ch.displacement.map(() => 0),
    },
  };
  const truthIsolated = !('true_rr_bpm' in mounted) && !('true_rr_bpm' in mounted.channels);
  const output = runEstimator(estimator, estimatorInput, {});
  // Truth is loaded separately, only for scoring.
  const truth = JSON.parse(fs.readFileSync(path.join(truthDir, 'truth.json'), 'utf-8'));
  return { output, truth, truthIsolated };
}

function receipt(recording, claim, outcome, extra = {}) {
  const m = recording.manifest;
  const subjects = recording.subjects || [];
  return {
    kind: 'external_evidence_receipt',
    evidence_id: m.evidence_id,
    provenance_class: m.provenance_class,
    dataset_name: m.source,
    dataset_version: m.dataset_version || null,
    source_reference: m.source_reference || m.source,
    license: m.license,
    retrieved_at: m.retrieved_at || null,
    raw_bundle_sha256: m.raw_hash,
    adapter_version: '1.0.0',
    adapter_config_hash: loadEnsembleConfig().config_hash,
    normalized_bundle_sha256: m.normalized_hash,
    subject_count: new Set(subjects.map((s) => s.subject_id)).size,
    session_count: new Set(subjects.map((s) => s.session_id)).size,
    recording_count: new Set(subjects.map((s) => s.recording_id)).size,
    excluded_recordings: extra.excluded || [],
    eligibility_status: extra.eligibility_status || 'ELIGIBLE',
    truth_isolation_verified: extra.truth_isolation_verified ?? null,
    claim_id: claim.claim_id,
    candidate: claim.candidate_estimator,
    outcome,
    detail: extra.detail || null,
    metrics: extra.metrics || null,
  };
}

export function evaluateExternal(recording, claim, opts = {}) {
  const workDir = opts.workDir || fs.mkdtempSync(path.join(require_tmpdir(), 'rl-ext-'));
  const m = recording.manifest;

  // 1. Eligibility (+ split protection).
  const elig = checkEligibility(m, recording.subjects);
  const split = checkSubjectSplit(recording.subjects);
  if (!elig.eligible || !split.clean) {
    const reasons = [...elig.reasons, ...(split.clean ? [] : [`subject leakage across splits: ${split.leaks.map((l) => l.subject_id).join(', ')}`])];
    return receipt(recording, claim, 'EVIDENCE_INELIGIBLE', { eligibility_status: 'EVIDENCE_INELIGIBLE', detail: reasons.join('; ') });
  }

  // 2. Adapter contract.
  const contract = validateAdapter(recording);
  if (!contract.pass) {
    return receipt(recording, claim, 'ADAPTER_INVALID', { detail: contract.violations.join('; ') });
  }

  // 3. Reference usable.
  if (m.reference_method === 'none' || !recording.truth || recording.truth.true_rr_bpm == null) {
    return receipt(recording, claim, 'REFERENCE_UNUSABLE', { detail: 'no usable reference respiratory rate' });
  }

  // 4. Signal-type compatibility.
  if (!DISPLACEMENT_SIGNALS.includes(m.signal_type)) {
    return receipt(recording, claim, 'SIGNAL_TYPE_INCOMPATIBLE', { detail: `signal_type '${m.signal_type}' is not a respiratory displacement signal` });
  }

  // 5. Claim applicability (valid data, wrong shape for the claim).
  const na = claimApplicability(claim, recording);
  if (na) return receipt(recording, claim, 'CLAIM_NOT_APPLICABLE', { detail: na });

  // 6. Label-blind execution + scoring.
  const { output, truth, truthIsolated } = isolateAndRun(recording, claim.candidate_estimator, workDir);
  if (output.abstained) {
    return receipt(recording, claim, 'ABSTAIN', { truth_isolation_verified: truthIsolated, detail: output.reason || 'estimator abstained' });
  }
  const metrics = scoreTrials([{ output, ground_truth: { target_present: true, recoverable: true, true_rr_bpm: truth.true_rr_bpm } }]);
  const tol = (claim.acceptance && claim.acceptance.mae_max) || 2.0;
  const err = Math.abs(output.rr_bpm - truth.true_rr_bpm);
  const outcome = err <= tol ? 'PASS' : 'FAIL';
  return receipt(recording, claim, outcome, {
    truth_isolation_verified: truthIsolated,
    metrics: { estimated_rr_bpm: output.rr_bpm, reference_rr_bpm: truth.true_rr_bpm, abs_error_bpm: round(err) },
    detail: `error ${round(err)} bpm vs tolerance ${tol}`,
  });
}

function require_tmpdir() {
  return process.env.TMPDIR || '/tmp';
}
function round(x, d = 4) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
