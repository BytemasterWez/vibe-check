// Canonical JSON + content hashing.
//
// Every hash the lab relies on (protocol freeze hash, dataset manifest hash,
// receipt evidence hash) is computed over a canonical serialization so that
// key order and whitespace can never change a hash. Mirrors the approach in
// capabilityproof/lib/evaluate.mjs but kept local to avoid a cross-module dep.

import crypto from 'crypto';

export function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

export function sha256(value) {
  const input = typeof value === 'string' ? value : canonicalize(value);
  return 'sha256:' + crypto.createHash('sha256').update(input).digest('hex');
}

// Short, stable id derived from content — used for deterministic experiment ids
// so a re-selection of the same experiment does not mint a new identity.
export function shortHash(value, n = 8) {
  return sha256(value).slice('sha256:'.length, 'sha256:'.length + n);
}
