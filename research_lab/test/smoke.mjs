#!/usr/bin/env node

// research_lab smoke test. No network access required. Proves the autonomous
// pre-hardware loop end to end and its safety invariants:
//
//   1. the RNG and Simulator A are deterministic (reproducibility foundation)
//   2. estimators recover a clean rate and abstain on an ambiguous second person
//   3. the statistician keeps coverage in [0,1] and applies the frozen utility
//   4. a preregistered protocol is hash-frozen and tamper-evident
//   5. the governor blocks forbidden actions and any advance past the C5 ceiling
//   6. the executor never leaks ground truth to the estimator
//   7. an experiment reproduces EXACTLY from its frozen protocol
//   8. receipts are ed25519-signed and break on mutation
//   9. a full campaign climbs C2->C5, escalates, and is idempotent on resume

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';

import { createRng } from '../lib/rng.mjs';
import { generate } from '../lib/simulator_a.mjs';
import { perturb } from '../lib/simulator_b.mjs';
import { runEstimator } from '../lib/estimators.mjs';
import { scoreTrials } from '../lib/statistician.mjs';
import { preregister, protocolIntact } from '../lib/prereg.mjs';
import { createGovernor } from '../lib/governor.mjs';
import { execute } from '../lib/executor.mjs';
import { reproduce } from '../lib/reproducer.mjs';
import { ensureKeys, signReceipt, buildReceipt, verifyReceiptSignature } from '../lib/receipts.mjs';
import { createStore } from '../lib/store.mjs';
import { seed } from '../lib/ledger.mjs';
import { runCampaign } from '../lib/orchestrator.mjs';
import { selectNext } from '../lib/selector.mjs';

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed++;
  console.log(`  ok  ${name}`);
}

console.log('research_lab smoke test\n');

// --- 1. Determinism --------------------------------------------------------
console.log('determinism');
{
  const a = createRng(42);
  const b = createRng(42);
  check('same-seed RNG matches', a.uniform() === b.uniform() && a.gaussian() === b.gaussian());
  const t1 = generate(104);
  const t2 = generate(104);
  check('Simulator A is deterministic', JSON.stringify(t1.channels) === JSON.stringify(t2.channels));
  check('Simulator A withholds ground truth in a separate block', t1.ground_truth && t1.ground_truth.true_rr_bpm > 0);
}

// --- 2. Estimator recover + abstain ---------------------------------------
console.log('estimators');
{
  const clean = generate(1902);
  const out = runEstimator('adaptive_motion_cancellation_v2', clean, { sqi_min: 6 });
  check('recovers clean rate within 2 bpm', !out.abstained && Math.abs(out.rr_bpm - clean.ground_truth.true_rr_bpm) < 2);

  // A loud second person (ratio near 1) is unrecoverable and should be abstained.
  let sawUnrecoverable = false;
  let abstainedOnUnrecoverable = false;
  for (const s of [7, 15, 23, 31, 45, 88]) {
    const base = generate(s);
    const trial = perturb(base, ['second_person'], 7);
    if (!trial.ground_truth.recoverable) {
      sawUnrecoverable = true;
      const r = runEstimator('bandpass_peak_v1', trial, { sqi_min: 6 });
      if (r.abstained) abstainedOnUnrecoverable = true;
    }
  }
  check('generates unrecoverable second-person trials', sawUnrecoverable);
  check('abstains on an unrecoverable second-person trial', abstainedOnUnrecoverable);
}

// --- 3. Statistician bounds + utility -------------------------------------
console.log('statistician');
{
  const trials = [
    { output: { abstained: false, rr_bpm: 12 }, ground_truth: { recoverable: true, true_rr_bpm: 12.1 } },
    { output: { abstained: true, rr_bpm: null }, ground_truth: { recoverable: false, true_rr_bpm: 30 } },
    { output: { abstained: false, rr_bpm: 5 }, ground_truth: { recoverable: false, true_rr_bpm: 30 } }, // dangerous
  ];
  const m = scoreTrials(trials, { error_tolerance_bpm: 2 });
  check('coverage stays within [0,1]', m.valid_coverage >= 0 && m.valid_coverage <= 1);
  check('false confident output is counted', m.false_confident_rate > 0);
  check('utility penalizes danger below coverage', m.utility < m.valid_coverage);
}

// --- 4. Preregistration freeze + tamper detection -------------------------
console.log('preregistration');
let protocol;
{
  const spec = {
    claim_id: 'CLM-RR-001',
    family: 'independent_data',
    advance_to: 'C3',
    hypothesis: 'x',
    candidate: 'adaptive_motion_cancellation_v2',
    baseline: 'bandpass_peak_v1',
    perturbations: [],
    seeds: [104, 833, 1902],
    acceptance: { mae_max: 2, coverage_min: 0.9, false_confident_max: 0.05, utility_min: 0.6 },
  };
  protocol = preregister(spec);
  check('protocol carries a freeze hash', protocol.protocol_hash.startsWith('sha256:'));
  check('frozen protocol verifies intact', protocolIntact(protocol));
  const tampered = { ...protocol, acceptance: { ...protocol.acceptance, mae_max: 999 } };
  check('threshold edit after freeze is detected', !protocolIntact(tampered));
}

// --- 5. Governor boundaries + ceiling -------------------------------------
console.log('governor');
{
  const gov = createGovernor();
  check('forbidden action blocked + escalated', gov.checkAction('purchase_hardware').escalate === true);
  check('advance past C5 ceiling blocked', gov.checkAdvance('C5', 'C6').allowed === false);
  check('advance within ceiling allowed', gov.checkAdvance('C3', 'C4').allowed === true);
  check('over-budget execution blocked', gov.checkExecution({ estimated_runtime_minutes: 999 }, {}).allowed === false);
}

// --- 6/7. Executor no-leak + exact reproduction ---------------------------
console.log('executor + reproducer');
let execResult;
{
  execResult = execute(protocol);
  check('leakage check is clean', execResult.leakage_check === 'clean');
  check('experiment passed on clean data', execResult.result === 'PASSED');
  const rep = reproduce(protocol, execResult);
  check('experiment reproduces EXACTLY', rep.status === 'EXACT_MATCH');
}

// --- 8. Receipt signing + tamper --------------------------------------------
console.log('receipts');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'research-lab-'));
  const keys = ensureKeys(path.join(tmp, 'keys'));
  const receipt = signReceipt(
    buildReceipt({ experiment_id: execResult.experiment_id, primary_metrics: execResult.primary_metrics, result: 'PASSED' }),
    keys.privateKey
  );
  check('receipt signature verifies', verifyReceiptSignature(receipt, keys.publicKey).valid);
  const mutated = { ...receipt, result: 'FAILED' };
  check('mutated receipt fails verification', !verifyReceiptSignature(mutated, keys.publicKey).valid);
}

// --- 9. Full campaign to ceiling, idempotent -------------------------------
console.log('campaign');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'research-lab-run-'));
  const dataDir = path.join(tmp, 'data');
  const store = createStore(dataDir);
  seed(store);

  // Run to exhaustion (each decision_required stops one turn; resume loops on).
  let escalations = 0;
  let terminal = null;
  for (let i = 0; i < 10; i++) {
    const r = runCampaign({ dataDir, maxSteps: 50 });
    if (r.stop.type === 'decision_required') escalations++;
    if (r.stop.type === 'terminal') {
      terminal = r.stop;
      break;
    }
  }
  const claims = store.listClaims();
  check('every claim reached the C5 ceiling', claims.every((c) => c.maturity === 'C5'));
  check('at least one C5 escalation was raised', escalations >= 1);
  check('loop reaches a clean terminal', terminal && terminal.reason === 'all_testable_claims_resolved');

  // Idempotent: a resolved campaign selects no further experiments.
  const completed = new Set(store.listReceipts().map((r) => `${r.claim_id}:${r.family}:${r.candidate}`));
  check('no further experiments selected when resolved', selectNext(store.listClaims(), completed) === null);

  // Every completed experiment reproduces exactly from its retained protocol.
  const receipts = store.listReceipts();
  let allExact = receipts.length > 0;
  for (const rec of receipts) {
    const p = JSON.parse(fs.readFileSync(path.join(store.dirs.protocols_completed, `${rec.experiment_id}.json`), 'utf-8'));
    if (reproduce(p, rec).status !== 'EXACT_MATCH') allExact = false;
  }
  check('all campaign receipts reproduce exactly', allExact);
}

console.log(`\n${passed} checks passed.`);
