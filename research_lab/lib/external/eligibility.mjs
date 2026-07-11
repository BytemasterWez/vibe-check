// Dataset eligibility + subject/session split protection (Packet 3 §6, §7).
//
// Not every public dataset is admissible. Ineligible datasets produce a hard
// EVIDENCE_INELIGIBLE with explicit reasons rather than quietly contributing
// evidence. Subject/session split protection prevents the same subject appearing
// across calibration and evaluation partitions — essential before any learned
// method is introduced, and cheap to enforce now.

export const MIN_RECORDING_DURATION_S = 30;

export function checkEligibility(manifest, subjects = []) {
  const reasons = [];
  const add = (ok, why) => {
    if (!ok) reasons.push(why);
  };

  add(Boolean(manifest.source && manifest.provenance_class), 'unknown provenance');
  add(Boolean(manifest.license) && manifest.license !== 'unknown', 'unusable or unknown licence');
  add(Boolean(manifest.reference_method) && manifest.reference_method !== 'none', 'no reference signal available');
  add(typeof manifest.recording_duration_s === 'number' && manifest.recording_duration_s >= MIN_RECORDING_DURATION_S, `recording shorter than ${MIN_RECORDING_DURATION_S}s`);
  add(manifest.sampling_rate_hz === 'unknown' ? false : typeof manifest.sampling_rate_hz === 'number', 'insufficient sampling metadata');
  add(!String(manifest.provenance_class || '').includes('simulated'), 'simulated data is not admissible as external evidence');

  // Duplicate recordings across splits.
  const byRecording = new Map();
  for (const s of subjects) {
    const key = s.recording_id;
    if (byRecording.has(key) && byRecording.get(key) !== s.split) {
      add(false, `duplicate recording ${key} across splits`);
    }
    byRecording.set(key, s.split);
  }

  return {
    eligible: reasons.length === 0,
    status: reasons.length === 0 ? 'ELIGIBLE' : 'EVIDENCE_INELIGIBLE',
    reasons,
  };
}

// A subject (or session/device) must not straddle calibration and evaluation.
export function checkSubjectSplit(subjects = []) {
  const leaks = [];
  const seen = new Map(); // subject_id -> Set(splits)
  for (const s of subjects) {
    if (!seen.has(s.subject_id)) seen.set(s.subject_id, new Set());
    seen.get(s.subject_id).add(s.split);
  }
  for (const [subject, splits] of seen) {
    if (splits.size > 1) leaks.push({ subject_id: subject, splits: [...splits] });
  }
  return { clean: leaks.length === 0, leaks };
}
