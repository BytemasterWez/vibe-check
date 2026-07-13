// Generic ed25519 signing for evidence artifacts (readiness certificates,
// behavioural reconciliations). Same mechanism receipts and attestations use:
// canonicalize the object without its signature field, sign, and prefix the
// algorithm. Kept here so new artifact types don't each re-implement it.

import crypto from 'crypto';
import { canonicalize } from './evaluate.mjs';

export function signObject(obj, privateKey, field = 'signature') {
  const unsigned = { ...obj };
  delete unsigned[field];
  const signature = crypto.sign(null, Buffer.from(canonicalize(unsigned)), privateKey);
  return { ...unsigned, [field]: 'ed25519:' + signature.toString('base64') };
}

export function verifyObject(obj, publicKey, field = 'signature') {
  if (!obj || !obj[field] || !String(obj[field]).startsWith('ed25519:')) {
    return { valid: false, reason: 'missing or malformed signature' };
  }
  const unsigned = { ...obj };
  delete unsigned[field];
  const sig = Buffer.from(String(obj[field]).slice('ed25519:'.length), 'base64');
  const valid = crypto.verify(null, Buffer.from(canonicalize(unsigned)), publicKey, sig);
  return { valid, reason: valid ? 'signature valid' : 'signature does not match contents' };
}
