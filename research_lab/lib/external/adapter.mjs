// Generic external-evidence adapter (Packet 3 §3).
//
// Ingests a recording the laboratory did NOT generate, applies an explicit,
// declared pipeline of transformations (each recorded, nothing silent), and
// produces a normalized, estimator-facing signal plus a manifest that binds the
// raw and normalized bytes by hash. The adapter never invents, resamples, crops
// or filters implicitly: every transformation must be declared, and re-running
// the declared pipeline must reproduce the normalized output exactly.
//
// Truth (reference labels) is kept in a SEPARATE structure from the normalized
// input, so the estimator can be run label-blind.

import { sha256 } from '../hash.mjs';

// The only transformations an adapter may apply — each pure and declared.
export const TRANSFORMS = {
  // Keep samples [start, end); declared crop, no silent trimming.
  crop: (x, { start = 0, end }) => x.slice(start, end ?? x.length),
  // Multiply by a scalar (unit conversion). Declared, exact.
  scale: (x, { factor }) => x.map((v) => v * factor),
  // Integer decimation by an explicit factor (declared downsample).
  decimate: (x, { factor }) => x.filter((_, i) => i % factor === 0),
  // Replace a declared missing-value sentinel with 0 and count it.
  fill_missing: (x, { sentinel }) => x.map((v) => (v === sentinel ? 0 : v)),
};

export function applyPipeline(raw, transformations = []) {
  let x = raw.slice();
  for (const t of transformations) {
    const fn = TRANSFORMS[t.op];
    if (!fn) throw new Error(`undeclared/unknown transform op: ${t.op}`);
    x = fn(x, t.params || {});
  }
  return x;
}

function countMissing(raw, sentinel) {
  if (sentinel === undefined) return 0;
  let n = 0;
  for (const v of raw) if (v === sentinel) n++;
  return n;
}

// Ingest a raw recording into a hash-bound evidence object. `manifestBase`
// carries provenance the human supplies (source, license, device, reference
// method, subject metadata). `truth` is kept apart from the estimator input.
export function ingest({ manifestBase, raw, transformations = [], truth = {}, subjects = [], missing_sentinel }) {
  const normalizedSignal = applyPipeline(raw, transformations);
  const fs = manifestBase.sampling_rate_hz;
  const decimation = transformations.filter((t) => t.op === 'decimate').reduce((a, t) => a * (t.params.factor || 1), 1);
  const normalized = {
    channels: { displacement: normalizedSignal },
    fs_hz: fs ? fs / decimation : null,
  };

  const manifest = {
    ...manifestBase,
    transformations,
    missing_values: countMissing(raw, missing_sentinel),
    raw_hash: sha256(raw),
    normalized_hash: sha256(normalized),
  };

  return {
    manifest,
    // estimator-facing input — NO truth fields here.
    input: normalized,
    // scorer-only truth, physically separate.
    truth,
    subjects,
    raw, // retained for reproduction/verification
  };
}
