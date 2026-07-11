// Adapter validation contract (Packet 3 §4).
//
// An estimator result is worthless if the adapter corrupted the evidence, so the
// adapter itself must pass BEFORE any claim is evaluated on external data. These
// checks are deliberately mechanical and reproducible.

import { sha256 } from '../hash.mjs';
import { applyPipeline } from './adapter.mjs';

const REQUIRED_MANIFEST_FIELDS = [
  'evidence_id',
  'source',
  'license',
  'acquisition_device',
  'sampling_rate_hz',
  'signal_type',
  'reference_method',
  'subject_count',
  'recording_duration_s',
  'label_origin',
  'units',
  'provenance_class',
];

// Forbidden keys on the estimator-facing input — any of these is a truth leak.
const TRUTH_KEYS = ['true_rr_bpm', 'reference_rate', 'label', 'labels', 'rr_bpm', 'annotation'];

function findTruthLeak(obj, path = 'input') {
  if (obj === null || typeof obj !== 'object') return null;
  for (const k of Object.keys(obj)) {
    if (TRUTH_KEYS.includes(k)) return `${path}.${k}`;
    const deeper = findTruthLeak(obj[k], `${path}.${k}`);
    if (deeper) return deeper;
  }
  return null;
}

export function validateAdapter(recording) {
  const v = [];
  const m = recording.manifest || {};
  const add = (ok, msg) => {
    if (!ok) v.push(msg);
  };

  // Required provenance fields present (sampling rate may be the explicit
  // sentinel "unknown", but the KEY must exist and be declared).
  for (const f of REQUIRED_MANIFEST_FIELDS) add(f in m, `missing manifest field: ${f}`);
  add(m.sampling_rate_hz === 'unknown' || typeof m.sampling_rate_hz === 'number', 'sampling rate neither a number nor explicitly "unknown"');

  // Raw + normalized hashes bind the bytes.
  add(m.raw_hash === sha256(recording.raw), 'raw_hash does not match raw bytes');
  add(m.normalized_hash === sha256(recording.input), 'normalized_hash does not match normalized input');

  // Transformations reproduce the normalized signal exactly (no silent edits).
  const rebuilt = applyPipeline(recording.raw, m.transformations || []);
  const rebuiltInput = { channels: { displacement: rebuilt }, fs_hz: recording.input.fs_hz };
  add(sha256(rebuiltInput) === m.normalized_hash, 'declared transformations do not reproduce the normalized signal (silent transformation)');

  // Time axis usable, missing values counted, channels mapped, units declared.
  add(Array.isArray(recording.input.channels?.displacement) && recording.input.channels.displacement.length > 0, 'no displacement channel mapped');
  add(typeof m.missing_values === 'number', 'missing values not counted');
  add(Boolean(m.units), 'units not declared');
  add(Boolean(m.label_origin), 'reference labels not traceable (label_origin)');

  // No target labels leaked into the estimator-facing input.
  const leak = findTruthLeak(recording.input);
  add(!leak, `truth leaked into estimator input at ${leak}`);
  add(recording.truth && Object.keys(recording.truth).length > 0, 'no separate scorer truth provided');

  return { pass: v.length === 0, violations: v };
}

// Determinism check: re-ingesting the same raw + transformations yields an
// identical normalized hash (the adapter is a pure function of its inputs).
export function reproductionExact(recording) {
  const rebuilt = applyPipeline(recording.raw, recording.manifest.transformations || []);
  const rebuiltInput = { channels: { displacement: rebuilt }, fs_hz: recording.input.fs_hz };
  return sha256(rebuiltInput) === recording.manifest.normalized_hash;
}
