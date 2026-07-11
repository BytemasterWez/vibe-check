// Claim ledger helpers: seeding the working store from the registry, and
// summarizing state for the CLI and the decision briefs.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, PRE_HARDWARE_CEILING } from './maturity.mjs';
import { decisionBrief, machineDigest } from './escalation.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = path.join(HERE, '..', 'registry', 'claims');

export function registryClaims() {
  return fs
    .readdirSync(REGISTRY)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(REGISTRY, f), 'utf-8')));
}

export function seed(store, { reset = false } = {}) {
  const seeded = [];
  for (const claim of registryClaims()) {
    if (store.getClaim(claim.claim_id) && !reset) continue;
    store.saveClaim(JSON.parse(JSON.stringify(claim)));
    seeded.push(claim.claim_id);
  }
  return seeded;
}

function claimState(c) {
  if (c.falsified) return 'FALSIFIED';
  if (c.blocked) return 'BLOCKED';
  if (c.software_ceiling_reached) return 'CEILING (hardware next)';
  return 'in-progress';
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
      state: claimState(c),
      steps_completed: (c.completed_steps || []).length,
      steps_total: (c.evidence_plan?.steps || []).length,
      supporting: (c.supporting_experiments || []).length,
      contradicting: (c.contradicting_experiments || []).length,
      open_uncertainties: c.open_uncertainties || [],
    })),
    experiments: { total: receipts.length, passed: byResult.PASSED || 0, failed: byResult.FAILED || 0 },
  };
}

// Categorize a claim's current escalation state for the decision brief.
export function claimCategory(claim) {
  if (claim.blocked) return 'NEEDS_NEW_SIMULATOR';
  if (claim.falsified) return 'CLAIM_FALSIFIED';
  if (claim.software_ceiling_reached) return 'SOFTWARE_CEILING_REACHED';
  return null;
}

function evidence(store, claimId) {
  const rs = store.listReceipts().filter((r) => r.claim_id === claimId);
  return {
    experiments: rs.length,
    passed: rs.filter((r) => r.result === 'PASSED').length,
    failed: rs.filter((r) => r.result === 'FAILED').length,
    simulator_families: [...new Set(rs.map((r) => r.world_family))],
  };
}

export function brief(store, claimId) {
  const claim = store.getClaim(claimId);
  const category = claimCategory(claim) || 'IN_PROGRESS';
  if (category === 'IN_PROGRESS') {
    return `${claim.claim_id}: in progress at ${claim.maturity} — ${(claim.completed_steps || []).length}/${
      (claim.evidence_plan?.steps || []).length
    } evidence steps complete. No decision required yet.`;
  }
  return decisionBrief({ category, claim, evidence: evidence(store, claimId) });
}

export function machineBrief(store, claimId) {
  const claim = store.getClaim(claimId);
  const category = claimCategory(claim) || 'IN_PROGRESS';
  return machineDigest({ category, claim, evidence: evidence(store, claimId) });
}
