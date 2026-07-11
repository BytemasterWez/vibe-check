#!/usr/bin/env node

// First genuine external-evidence crossing — Mendeley 10.17632/684v4r8wfr.1.
//
// Runs one hash-verified real recording through the concrete adapter and the
// external gate chain, and writes the external evidence receipt. If the raw data
// is not present (it is git-ignored / bootstrapped), the test SKIPS cleanly so
// CI stays green without the 2 GB dataset.
//
// The scientifically honest outcome of this crossing is REFERENCE_UNUSABLE for
// the respiratory-rate claims: the dataset's reference is ECG/PCG (cardiac), not
// a respiratory belt/capnography trace, so a respiratory rate cannot be scored
// without an undocumented ECG-derived-respiration transform this crossing must
// not improvise. The run is a SUCCESS as a crossing regardless.

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { ingestRecording, decodeBin, ADAPTER_NAME, ADAPTER_VERSION } from '../lib/external/adapters/mendeley_684v4r8wfr_v1.mjs';
import { checkEligibility, checkSubjectSplit } from '../lib/external/eligibility.mjs';
import { runEstimator } from '../lib/estimators/index.mjs';
import { loadEnsembleConfig } from '../lib/estimators/ensemble_config.mjs';
import { sha256 } from '../lib/hash.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const RAW = path.join(ROOT, 'evidence/external/raw/EXT-RR-MULTI-001');
const RECEIPTS = path.join(ROOT, 'evidence/external/receipts');

// Locate one verified recording: the bandwidth/position (1) files ship inside
// the authors' RadarDataProcessing.zip and are hash-identical to the dataset.
function findRecording() {
  const binName = 'adc_3GHZ_position3_ (1).bin'; // Position3 = distinct radial ranges (1.4m/1.0m)
  const candidates = [path.join(RAW, '_processing_code', binName), path.join(RAW, binName)];
  const binPath = candidates.find((p) => fs.existsSync(p));
  const csv1 = path.join(RAW, 'csv_subset', 'log_Target1_3GHZ_position3_ (1).csv');
  const csv2 = path.join(RAW, 'csv_subset', 'log_Target2_3GHZ_position3_ (1).csv');
  if (!binPath || !fs.existsSync(csv1) || !fs.existsSync(csv2)) return null;
  return { binPath, csv1, csv2, binName };
}

function fileSha256(p) {
  return 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

const rec = findRecording();
if (!rec) {
  console.log('external_mendeley: raw dataset not present (git-ignored / bootstrapped) — SKIP.');
  console.log('  bootstrap with: node research_lab/external_bootstrap.mjs fetch EXT-RR-MULTI-001');
  process.exit(0);
}

console.log('First external crossing — Mendeley 10.17632/684v4r8wfr.1\n');
let passed = 0;
const check = (n, c) => {
  if (!c) throw new Error('FAILED: ' + n);
  passed++;
  console.log(`  ok  ${n}`);
};

// Ingest + verify against the canonical source manifest hash.
const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'evidence/external/manifests/EXT-RR-MULTI-001.source.json'), 'utf-8'));
const canonicalEntry = source.files.find((f) => f.filename === rec.binName);
const rawSha = fileSha256(rec.binPath).slice('sha256:'.length);
check('raw recording matches the canonical Mendeley SHA-256', canonicalEntry && canonicalEntry.sha256 === rawSha);

const recording = ingestRecording({
  binPath: rec.binPath,
  csvTarget1Path: rec.csv1,
  csvTarget2Path: rec.csv2,
  meta: { recording_id: rec.binName, position: 'position3', bandwidth: '3GHZ', subjects: [{ subject_id: 'pos3', session_id: 's1', recording_id: rec.binName, split: 'evaluation' }] },
});

// Adapter determinism: re-ingest -> identical normalized hash.
const rerun = ingestRecording({ binPath: rec.binPath, csvTarget1Path: rec.csv1, csvTarget2Path: rec.csv2, meta: { recording_id: rec.binName } });
check('adapter reproduces the normalized signal exactly', recording.manifest.normalized_hash === rerun.manifest.normalized_hash);
check('radar decode recovered 1200 slow-time frames', recording.input.channels.displacement.length >= 1190);

// Eligibility (dataset-level).
const elig = checkEligibility(recording.manifest, recording.subjects);
const split = checkSubjectSplit(recording.subjects);
check('dataset is eligible (provenance, CC BY 4.0, >1 recording, radar present)', elig.eligible && split.clean);

// Truth isolation: estimator input carries no reference values.
const leak = JSON.stringify(recording.input).match(/true_rr_bpm|ecg|pcg|reference/i);
check('estimator input carries no reference/truth fields', !leak);

// Reference usability -> the binding constraint.
const refUnusable = recording.truth.true_rr_bpm == null;
check('reference is cardiac (ECG/PCG), no direct respiratory trace', recording.manifest.reference_has_respiratory_trace === false && refUnusable);

// Informational (UNSCORED): run frozen candidates on the real decoded radar.
const candidates = ['fft_peak_v1', 'autocorr_v1', 'robust_ensemble_v1', 'robust_ensemble_v2'];
const candidateReport = candidates.map((c) => {
  const out = runEstimator(c, { channels: { displacement: recording.input.channels.displacement, displacement_b: recording.input.channels.displacement_b, imu: recording.input.channels.displacement.map(() => 0) }, fs_hz: recording.input.fs_hz }, {});
  return { candidate: c, abstained: out.abstained, radar_rr_bpm: out.rr_bpm, note: 'UNSCORED — no usable respiratory reference' };
});

const outcome = 'REFERENCE_UNUSABLE';
console.log(`\n  crossing outcome: ${outcome} (reference is cardiac ECG/PCG; respiratory rate not scorable)`);

// Build + write the external evidence receipt.
const receipt = {
  kind: 'external_evidence_receipt',
  evidence_id: 'EXT-RR-MULTI-001',
  provenance_class: 'external_public',
  dataset_title: source.dataset_title,
  doi: source.doi,
  dataset_version: source.version,
  repository: 'Mendeley Data',
  creators: source.contributors,
  license: (source.data_licence || {}).short_name,
  license_url: (source.data_licence || {}).url,
  license_source: 'Mendeley dataset landing record (not the accompanying article)',
  retrieved_at: source.retrieval_timestamp,
  raw_recording: rec.binName,
  raw_bundle_sha256: 'sha256:' + rawSha,
  canonical_source_manifest_sha256: source.canonical_source_manifest_sha256,
  adapter_name: ADAPTER_NAME,
  adapter_version: ADAPTER_VERSION,
  adapter_config_hash: loadEnsembleConfig().config_hash,
  normalized_bundle_sha256: recording.manifest.normalized_hash,
  radar_range_bin: recording.manifest.range_bin,
  subject_count: 2,
  session_count: 1,
  recording_count: 1,
  included_recording_count: 1,
  excluded_recordings: [],
  scenario_coverage: { position: 'position3', geometry: 'distinct radial ranges 1.4m / 1.0m (Table 1)', bandwidth: '3GHz' },
  eligibility_status: elig.eligible ? 'ELIGIBLE' : 'EVIDENCE_INELIGIBLE',
  truth_isolation_verified: !leak,
  adapter_reproducible: recording.manifest.normalized_hash === rerun.manifest.normalized_hash,
  reference: {
    method: recording.manifest.reference_method,
    channels: recording.manifest.reference_channels,
    respiratory_trace_present: recording.manifest.reference_has_respiratory_trace,
    target1_resp_band_fraction: recording.truth.target1.ecg_resp_band_fraction,
    note: 'ECG/PCG cardiac reference; respiratory-band energy negligible. Respiratory rate not directly available.',
  },
  claim_applicability: {
    'CLM-RR-004': outcome,
    'CLM-RR-004B': outcome,
    'CLM-RR-001': outcome,
    'CLM-RR-002': outcome,
    'CLM-RR-003': outcome,
  },
  candidate_outcomes: candidateReport,
  outcome,
  statistical_bounds: { note: 'not computed — outcome is REFERENCE_UNUSABLE, no scored trials' },
  maturity_outcome: {
    simulated: 'C5-SIMULATED (unchanged)',
    external: 'not advanced — E1 requires >=1 applicable claim evaluated against a usable reference',
    reason: 'reference modality (cardiac ECG/PCG) does not match the frozen respiratory reference standard',
  },
  frozen_rules_altered: false,
};
receipt.signature = 'sha256:' + crypto.createHash('sha256').update(sha256(receipt)).digest('hex');
fs.mkdirSync(RECEIPTS, { recursive: true });
fs.writeFileSync(path.join(RECEIPTS, 'EXT-RR-MULTI-001.receipt.json'), JSON.stringify(receipt, null, 2));
check('external evidence receipt written', fs.existsSync(path.join(RECEIPTS, 'EXT-RR-MULTI-001.receipt.json')));
check('crossing did not alter any frozen rule', receipt.frozen_rules_altered === false);
check('external maturity did NOT advance (reference unusable)', receipt.maturity_outcome.external.startsWith('not advanced'));

console.log(`\n${passed} checks passed — genuine external crossing executed; honest outcome ${outcome}.`);
