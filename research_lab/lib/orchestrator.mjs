// Orchestrator — the closed autonomous loop (blueprint flowchart).
//
//   ledger -> find highest uncertainty -> design falsification experiment
//   -> preregister -> execute in isolation -> analyse vs frozen criteria
//   -> independent red-team review -> reproduce from raw inputs
//   -> update claim maturity -> ledger ...
//
// It stops automatically at a terminal condition and never advances a claim
// past the pre-hardware ceiling. Every gate decision is deterministic code; no
// model call is on the critical path.

import path from 'path';
import { createStore } from './store.mjs';
import { createGovernor } from './governor.mjs';
import { selectNext } from './selector.mjs';
import { preregister } from './prereg.mjs';
import { execute } from './executor.mjs';
import { critique } from './critic.mjs';
import { reproduce } from './reproducer.mjs';
import { ensureKeys, signReceipt, buildReceipt, RUNNER_VERSION } from './receipts.mjs';
import { PRE_HARDWARE_CEILING } from './maturity.mjs';

function signature(claimId, family, candidate) {
  return `${claimId}:${family}:${candidate}`;
}

function runtimeEnv(overrides = {}) {
  return { on_power: true, free_disk_gb: 100, ...overrides };
}

// One full turn of the loop. Returns a step record describing what happened.
export function step(store, governor, keys, env) {
  const claims = store.listClaims();
  const receipts = store.listReceipts();
  const completed = new Set(receipts.map((r) => signature(r.claim_id, r.family, r.candidate)));

  // Promote any claim that has cleared adversarial (C4) to the software ceiling
  // (C5) — this is the "pre-hardware evidence ceiling" terminal, and it demands
  // a human/hardware decision.
  for (const claim of claims) {
    if (claim.maturity === 'C4') {
      const adv = governor.checkAdvance('C4', 'C5');
      if (adv.allowed) {
        claim.maturity = 'C5';
        store.saveClaim(claim);
        store.log({ event: 'maturity_ceiling', claim_id: claim.claim_id, to: 'C5' });
        return {
          type: 'decision_required',
          claim_id: claim.claim_id,
          reason: 'claim reached C5 — software evidence ceiling; hardware experiment required to progress',
        };
      }
    }
  }

  const selection = selectNext(claims, completed);
  if (!selection) {
    return { type: 'terminal', reason: 'all_testable_claims_resolved' };
  }

  const claim = store.getClaim(selection.claim_id);
  const spec = { claim_id: claim.claim_id, ...selection.spec };

  // Governor budget/boundary gate before anything runs.
  const experiment = { estimated_runtime_minutes: spec.seeds.length * 0.01 };
  const gate = governor.checkExecution(experiment, env);
  if (!gate.allowed) {
    return { type: 'halt', reason: 'resource_limit_reached', detail: gate.reasons };
  }

  // Preregister and freeze.
  const protocol = preregister(spec);
  store.savePreregistered(protocol);

  // If this exact frozen experiment already has a receipt, we've duplicated —
  // guard against an infinite loop of an unadvanceable claim.
  if (store.getReceipt(protocol.experiment_id)) {
    return { type: 'halt', reason: 'duplicate_experiment', experiment_id: protocol.experiment_id };
  }

  // Execute in isolation, red-team, reproduce.
  const execResult = execute(protocol);
  const review = critique(execResult);
  const reproduction = reproduce(protocol, execResult);

  const passed = execResult.result === 'PASSED';
  const trustworthy = passed && review.verdict === 'no_alternative_explanation' && reproduction.status === 'EXACT_MATCH';

  // Decide the claim effect. Advance only on a trustworthy pass, and only if the
  // governor permits the specific transition.
  let maturityChange = 'NONE';
  let newMaturity = claim.maturity;
  if (trustworthy) {
    const adv = governor.checkAdvance(claim.maturity, selection.target);
    if (adv.allowed) {
      newMaturity = selection.target;
      maturityChange = `${claim.maturity}->${selection.target}`;
    }
  }

  // Assemble and sign the receipt (blueprint §10).
  const receipt = signReceipt(
    buildReceipt({
      experiment_id: protocol.experiment_id,
      claim_id: claim.claim_id,
      family: spec.family,
      candidate: spec.candidate,
      baseline: spec.baseline,
      protocol_hash: protocol.protocol_hash,
      runner_version: RUNNER_VERSION,
      input_manifest_hash: execResult.input_manifest_hash,
      started_at: execResult.started_at,
      completed_at: execResult.completed_at,
      acceptance_criteria_frozen: execResult.acceptance_criteria_frozen,
      result: execResult.result,
      failed_reasons: execResult.failed_reasons,
      primary_metrics: execResult.primary_metrics,
      baseline_metrics: execResult.baseline_metrics,
      leakage_check: execResult.leakage_check,
      red_team: { verdict: review.verdict, findings: review.findings, tracking_correlation: review.tracking_correlation },
      reproduction_status: reproduction.status,
      claim_effect: {
        claim_id: claim.claim_id,
        maturity_change: maturityChange,
        new_uncertainty: review.new_uncertainty,
      },
    }),
    keys.privateKey
  );
  store.saveReceipt(receipt);
  store.completeProtocol(protocol.experiment_id);

  // Update the ledger.
  if (maturityChange !== 'NONE') claim.maturity = newMaturity;
  claim.supporting_experiments = claim.supporting_experiments || [];
  claim.contradicting_experiments = claim.contradicting_experiments || [];
  if (passed) claim.supporting_experiments.push(protocol.experiment_id);
  else claim.contradicting_experiments.push(protocol.experiment_id);
  if (review.new_uncertainty && !(claim.open_uncertainties || []).includes(review.new_uncertainty)) {
    claim.open_uncertainties = [...(claim.open_uncertainties || []), review.new_uncertainty];
  }
  store.saveClaim(claim);

  governor.recordResult(passed);
  store.log({
    event: 'experiment_complete',
    experiment_id: protocol.experiment_id,
    claim_id: claim.claim_id,
    result: execResult.result,
    maturity_change: maturityChange,
    reproduction: reproduction.status,
    red_team: review.verdict,
  });

  const halt = governor.shouldHaltForFailures();
  if (halt.halt) {
    return { type: 'halt', reason: 'repeated_failure_without_information_gain', detail: halt.reason, experiment_id: protocol.experiment_id };
  }

  return {
    type: 'experiment',
    experiment_id: protocol.experiment_id,
    claim_id: claim.claim_id,
    result: execResult.result,
    maturity_change: maturityChange,
    reproduction: reproduction.status,
    red_team: review.verdict,
    metrics: execResult.primary_metrics,
  };
}

// Run the loop to a terminal condition (or a safety cap on iterations).
export function runCampaign(opts = {}) {
  const dataDir = opts.dataDir || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
  const store = createStore(dataDir);
  const governor = createGovernor();
  const keys = ensureKeys(store.dirs.keys);
  const env = runtimeEnv(opts.env);
  const maxSteps = opts.maxSteps ?? 100;

  const steps = [];
  let stop = null;
  for (let i = 0; i < maxSteps; i++) {
    const s = step(store, governor, keys, env);
    steps.push(s);
    if (s.type === 'terminal' || s.type === 'halt' || s.type === 'decision_required') {
      stop = s;
      break;
    }
  }
  if (!stop) stop = { type: 'halt', reason: 'max_steps_reached' };

  return { steps, stop, ceiling: PRE_HARDWARE_CEILING, dataDir };
}
