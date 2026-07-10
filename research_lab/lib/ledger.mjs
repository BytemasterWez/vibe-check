// Claim ledger helpers: seeding the working store from the registry, and
// summarizing state for the CLI and the decision digest.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, PRE_HARDWARE_CEILING } from './maturity.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = path.join(HERE, '..', 'registry', 'claims');

export function registryClaims() {
  return fs
    .readdirSync(REGISTRY)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(REGISTRY, f), 'utf-8')));
}

// Seed (or reset) the working store from the immutable registry. Reset restores
// the declared starting maturity — used to rerun a campaign from scratch.
export function seed(store, { reset = false } = {}) {
  const seeded = [];
  for (const claim of registryClaims()) {
    const existing = store.getClaim(claim.claim_id);
    if (existing && !reset) continue;
    store.saveClaim(JSON.parse(JSON.stringify(claim)));
    seeded.push(claim.claim_id);
  }
  return seeded;
}

export function summarize(store) {
  const claims = store.listClaims();
  const receipts = store.listReceipts();
  const byResult = { PASSED: 0, FAILED: 0 };
  for (const r of receipts) byResult[r.result] = (byResult[r.result] || 0) + 1;

  return {
    ceiling: PRE_HARDWARE_CEILING,
    claims: claims.map((c) => ({
      claim_id: c.claim_id,
      statement: c.statement,
      maturity: c.maturity,
      maturity_name: describe(c.maturity).name,
      open_uncertainties: c.open_uncertainties || [],
      supporting: (c.supporting_experiments || []).length,
      contradicting: (c.contradicting_experiments || []).length,
    })),
    experiments: { total: receipts.length, passed: byResult.PASSED || 0, failed: byResult.FAILED || 0 },
  };
}

// The one-decision digest (blueprint §13): terse, actionable, no sprawl.
export function decisionDigest(store, claimId) {
  const claim = store.getClaim(claimId);
  const receipts = store.listReceipts().filter((r) => r.claim_id === claimId);
  const passed = receipts.filter((r) => r.result === 'PASSED').length;
  const failed = receipts.filter((r) => r.result === 'FAILED').length;
  const resolved = passed
    ? 'Respiratory frequency is recoverable under modeled conditions, with correct abstention on unrecoverable trials.'
    : 'No passing evidence yet.';
  const unresolved = (claim.open_uncertainties || []).join(', ') || 'none tracked';

  return [
    `DECISION REQUIRED: ${claim.claim_id}`,
    `Pre-hardware status: ${claim.maturity}`,
    `Completed experiments: ${receipts.length}`,
    `Passed: ${passed}`,
    `Failed: ${failed}`,
    `Resolved:`,
    `  ${resolved}`,
    `Unresolved (software-untestable without hardware):`,
    `  ${unresolved}`,
    `Next step requiring expenditure:`,
    `  A physical mmWave evaluation board to measure real SNR and handheld-motion coupling.`,
    `Recommendation:`,
    `  Do not purchase until every claim's software campaign has reached its ceiling.`,
  ].join('\n');
}
