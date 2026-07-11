// Deterministic synthetic recording, used ONLY to self-test the external
// adapter machinery (contract, eligibility, split, blindness). It is clearly
// labelled and is NEVER real external evidence: eligibility rejects a
// `simulated`/`simulated_fixture` provenance, and no claim advances on it. A real
// dataset is dropped into evidence/external/ by a human; this fixture only proves
// the plumbing is correct before that happens.

import { createRng } from '../rng.mjs';
import { ingest } from './adapter.mjs';

// Build a recording. Knobs let tests exercise the failure paths:
//   corrupt: 'hash' | 'undeclared' | 'leak'
//   ineligible: 'license' | 'short' | 'simulated' | 'no_reference'
//   splitLeak: true  -> same subject in both splits
export function makeFixtureRecording(opts = {}) {
  const seed = opts.seed ?? 1;
  const rng = createRng(seed >>> 0);
  const fsRaw = 40;
  const durationS = opts.ineligible === 'short' ? 10 : 60;
  const n = fsRaw * durationS;
  const rrBpm = rng.range(10, 22);
  const fr = rrBpm / 60;

  // Raw signal in "device units" (mm), decimated later to the estimator rate.
  const raw = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / fsRaw;
    raw[i] = 5.0 * Math.sin(2 * Math.PI * fr * t) + rng.gaussian(0, 0.4);
  }

  const provByIneligible = { simulated: 'simulated_fixture', undefined: 'public_dataset' };
  const provenance = provByIneligible[opts.ineligible] ?? (opts.ineligible === 'simulated' ? 'simulated_fixture' : 'public_dataset');

  const manifestBase = {
    evidence_id: `EXT-FIX-${seed}`,
    source: 'synthetic_fixture_v1',
    license: opts.ineligible === 'license' ? 'unknown' : 'CC0',
    acquisition_device: 'synthetic',
    sampling_rate_hz: fsRaw,
    signal_type: 'chest_displacement',
    reference_method: opts.ineligible === 'no_reference' ? 'none' : 'respiratory_belt',
    subject_count: 1,
    recording_duration_s: durationS,
    label_origin: 'synthetic_ground_truth',
    units: 'mm',
    provenance_class: provenance,
  };

  // Declared transformations: convert mm->normalized (scale) and decimate to 20 Hz.
  const transformations = [
    { op: 'scale', params: { factor: 0.2 } },
    { op: 'decimate', params: { factor: 2 } },
  ];

  const subjects = [
    { subject_id: `S${seed}`, session_id: `sess-${seed}`, recording_id: `rec-${seed}`, device_id: 'dev-1', site_id: 'site-1', split: 'evaluation' },
  ];
  if (opts.splitLeak) {
    subjects.push({ subject_id: `S${seed}`, session_id: `sess-${seed}b`, recording_id: `rec-${seed}b`, device_id: 'dev-1', site_id: 'site-1', split: 'calibration' });
  }

  const recording = ingest({
    manifestBase,
    raw,
    transformations,
    truth: { true_rr_bpm: rrBpm },
    subjects,
  });

  // Inject the requested corruption AFTER a valid ingest so the contract catches it.
  if (opts.corrupt === 'hash') {
    recording.manifest.normalized_hash = 'sha256:deadbeef';
  } else if (opts.corrupt === 'undeclared') {
    // Silently alter the normalized signal without declaring a transformation.
    recording.input.channels.displacement = recording.input.channels.displacement.map((v) => v * 1.5);
  } else if (opts.corrupt === 'leak') {
    // Leak the reference rate into the estimator-facing input.
    recording.input.true_rr_bpm = recording.truth.true_rr_bpm;
  }

  return recording;
}
