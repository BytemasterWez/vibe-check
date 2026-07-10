// Signed experiment receipts (blueprint §10).
//
// A receipt records exactly what ran and what the frozen criteria said about
// it: the preregistered protocol hash, the code/runner version, the input
// manifest hash, timings, the primary metrics, PASS/FAIL against criteria that
// were frozen BEFORE execution, and the resulting claim effect. Signed with a
// local ed25519 key so any later edit is detectable.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { canonicalize, sha256 } from './hash.mjs';

export const RUNNER_VERSION = '1.0.0';

export function ensureKeys(keyDir) {
  fs.mkdirSync(keyDir, { recursive: true });
  const privPath = path.join(keyDir, 'signing-key.pem');
  const pubPath = path.join(keyDir, 'signing-key.pub.pem');
  if (!fs.existsSync(privPath)) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    fs.writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));
  }
  return {
    privateKey: crypto.createPrivateKey(fs.readFileSync(privPath)),
    publicKey: crypto.createPublicKey(fs.readFileSync(pubPath)),
  };
}

export function signReceipt(receipt, privateKey) {
  const unsigned = { ...receipt };
  delete unsigned.signature;
  const sig = crypto.sign(null, Buffer.from(canonicalize(unsigned)), privateKey);
  return { ...unsigned, signature: 'ed25519:' + sig.toString('base64') };
}

export function verifyReceiptSignature(receipt, publicKey) {
  if (!receipt || !receipt.signature || !receipt.signature.startsWith('ed25519:')) {
    return { valid: false, reason: 'missing or malformed signature' };
  }
  const unsigned = { ...receipt };
  delete unsigned.signature;
  const sig = Buffer.from(receipt.signature.slice('ed25519:'.length), 'base64');
  const valid = crypto.verify(null, Buffer.from(canonicalize(unsigned)), publicKey, sig);
  return { valid, reason: valid ? 'signature valid' : 'signature does not match receipt contents' };
}

export function buildReceipt(fields) {
  return {
    receipt_version: '1.0',
    runner_version: RUNNER_VERSION,
    ...fields,
  };
}

export { sha256 };
