// Signed capability receipts.
//
// A receipt is a short-lived, machine-readable statement of what was tested
// and what the evidence showed. Receipts are signed with a local ed25519 key
// so consumers can detect tampering; the evidence hash binds the receipt to
// the stored raw evidence.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { canonicalize } from './evaluate.mjs';

const DEFAULT_TTL_HOURS = 6;

export function ensureKeys(dataDir) {
  const keyDir = path.join(dataDir, 'keys');
  fs.mkdirSync(keyDir, { recursive: true });
  const privPath = path.join(keyDir, 'signing-key.pem');
  const pubPath = path.join(keyDir, 'signing-key.pub.pem');

  if (!fs.existsSync(privPath)) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    fs.writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));
  }
  const privateKey = crypto.createPrivateKey(fs.readFileSync(privPath));
  const publicKey = crypto.createPublicKey(fs.readFileSync(pubPath));
  return {
    privateKey,
    publicKey,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

export function newReceiptId() {
  return 'cpr_' + crypto.randomBytes(12).toString('base64url');
}

export function evidenceHash(evidence) {
  return 'sha256:' + crypto.createHash('sha256').update(canonicalize(evidence)).digest('hex');
}

export function buildReceipt({ manifest, probe, evaluation, history, evidenceHashValue, ttlHours }) {
  const ttl = ttlHours ?? manifest.receipt_ttl_hours ?? DEFAULT_TTL_HOURS;
  const verifiedAt = new Date();
  // 'unreachable' is reserved for transport failure; an endpoint that answers
  // with the wrong content (even a 200 HTML error page) is 'failed_checks'.
  const status = evaluation.results.task_success
    ? 'verified'
    : probe.error
      ? 'unreachable'
      : 'failed_checks';

  return {
    receipt_id: newReceiptId(),
    receipt_version: '1.0',
    capability_id: manifest.capability_id,
    claim: manifest.claim,
    status,
    verified_at: verifiedAt.toISOString(),
    expires_at: new Date(verifiedAt.getTime() + ttl * 3600000).toISOString(),
    protocol: manifest.protocol,
    risk_class: manifest.risk_class,
    test_pack: manifest.test_pack.id,
    probe: {
      url: probe.url,
      method: probe.method,
      http_status: probe.status,
      fetched_at: probe.fetched_at,
      error: probe.error,
    },
    results: evaluation.results,
    failures: evaluation.failures,
    history,
    fallback_capability_ids: manifest.fallback_capability_ids || [],
    evidence_hash: evidenceHashValue,
  };
}

export function signReceipt(receipt, privateKey) {
  const unsigned = { ...receipt };
  delete unsigned.signature;
  const signature = crypto.sign(null, Buffer.from(canonicalize(unsigned)), privateKey);
  return { ...unsigned, signature: 'ed25519:' + signature.toString('base64') };
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

export function receiptIsFresh(receipt, now = Date.now()) {
  return Boolean(receipt && receipt.expires_at && Date.parse(receipt.expires_at) > now);
}
