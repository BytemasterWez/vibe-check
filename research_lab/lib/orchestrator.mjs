// Orchestrator — the closed autonomous loop, cross-world edition.
//
// Each turn either (a) resolves a claim's fully-run evidence-plan step by the
// cross-world quorum + hard safety constraints, (b) runs the next highest-
// information experiment, or (c) escalates something the loop cannot resolve
// autonomously. A claim advances ONLY when independent world families agree AND
// the hard constraints pass — a high utility can never buy back a dangerous
// confident-error class, and evidence from a single world family is never
// enough. Nothing advances past the pre-hardware ceiling (C5).

import path from 'path';
import { createStore } from './store.mjs';
import { createGovernor } from './governor.mjs';
import { selectNext, currentStep, worldStatus } from './selector.mjs';
import { preregister } from './prereg.mjs';
import { execute } from './executor.mjs';
import { critique } from './critic.mjs';
import { reproduce } from './reproducer.mjs';
import { ensureKeys, signReceipt, buildReceipt, RUNNER_VERSION } from './receipts.mjs';
import { ESTIMATOR_FAMILIES } from './estimators/index.mjs';
import { ALL_WORLDS } from './simulators/index.mjs';
import { PRE_HARDWARE_CEILING } from './maturity.mjs';
import { machineDigest } from './escalation.mjs';
import { diversityReport } from './diversity.mjs';
import { isAutonomous, ingestEscalationFor } from './provenance.mjs';

function runtimeEnv(overrides = {}) {
  return { on_power: true, free_disk_gb: 100, ...overrides };
}

function trustworthyPass(r) {
  return r.result === 'PASSED' && r.reproduction_status === 'EXACT_MATCH' && r.red_team?.verdict === 'no_alternative_explanation';
}
function trustworthyFail(r) {
  return r.result === 'FAILED' && r.reproduction_status === 'EXACT_MATCH';
}

function claimsByPriority(claims) {
  return claims.slice().sort((a, b) => (b.clinical_relevance ?? 1) - (a.clinical_relevance ?? 1));
}

function evidenceSummary(store, claimId) {
  const rs = store.listReceipts().filter((r) => r.claim_id === claimId);
  return {
    experiments: rs.length,
    passed: rs.filter((r) => r.result === 'PASSED').length,
    failed: rs.filter((r) => r.result === 'FAILED').length,
    simulator_families: [...new Set(rs.map((r) => r.world_family))],
    estimator_families: [...new Set(rs.map((r) => ESTIMATOR_FAMILIES[r.candidate]).filter(Boolean))],
  };
}

// Resolve a claim whose current step has been fully run: advance or falsify.
function resolveStep(store, governor, claim, step, receipts) {
  const rs = receipts.filter((r) => r.claim_id === claim.claim_id && r.step_id === step.id);
  const fails = rs.filter(trustworthyFail);
  const passes = rs.filter(trustworthyPass);
  const passedFamilies = new Set(passes.map((r) => r.world_family));

  const sum = (f) => rs.reduce((a, r) => a + (r.primary_metrics[f] ?? 0), 0);
  const aggregate = {
    // Aggregate EVENT COUNTS across the step's world experiments so the hard
    // constraint can gate on a confidence bound rather than a small-sample rate.
    false_confident_count: sum('false_confident_count'),
    false_confident_trials: sum('n_trials'),
    target_absent_false_positive_count: sum('target_absent_false_positive_count'),
    target_absent_trials: sum('n_target_absent'),
    reproduction_status: rs.every((r) => r.reproduction_status === 'EXACT_MATCH') ? 'EXACT_MATCH' : 'MISMATCH',
    critical_scenario_coverage: Math.min(1, passedFamilies.size / step.min_families),
  };
  const hard = governor.checkHardConstraints(aggregate);

  const steps = claim.evidence_plan.steps;
  const isLast = steps[steps.length - 1].id === step.id;

  // --- Falsification: a valid, reproduced failure on any world, OR the step
  //     cannot meet the cross-world quorum / hard constraints. ---
  const cannotAdvance = fails.length > 0 || passedFamilies.size < step.min_families || !hard.pass;
  if (cannotAdvance) {
    claim.falsified = true;
    claim.contradicting_experiments = [...(claim.contradicting_experiments || []), ...rs.map((r) => r.experiment_id)];
    store.saveClaim(claim);
    const detail = fails.length
      ? `fails on world(s): ${fails.map((r) => r.world_family).join(', ')}`
      : passedFamilies.size < step.min_families
        ? `only ${passedFamilies.size}/${step.min_families} world families passed — insufficient cross-world support`
        : `hard-constraint violations: ${hard.violations.map((v) => v.constraint).join(', ')}`;
    store.log({ event: 'claim_falsified', claim_id: claim.claim_id, step: step.id, detail });
    governor.recordResult(false);
    return {
      type: 'escalation',
      category: 'CLAIM_FALSIFIED',
      claim_id: claim.claim_id,
      step: step.id,
      detail,
      digest: machineDigest({ category: 'CLAIM_FALSIFIED', claim, evidence: evidenceSummary(store, claim.claim_id), detail }),
    };
  }

  // --- Advance: quorum met and constraints pass. ---
  const adv = governor.checkAdvance(claim.maturity, step.advance_to);
  if (!adv.allowed) {
    // Should not happen within the ceiling, but never silently promote.
    return { type: 'escalation', category: 'NEEDS_CLINICAL_REVIEW', claim_id: claim.claim_id, detail: adv.reasons.join('; ') };
  }
  claim.maturity = step.advance_to;
  claim.completed_steps = [...(claim.completed_steps || []), step.id];
  claim.supporting_experiments = [...(claim.supporting_experiments || []), ...passes.map((r) => r.experiment_id)];
  governor.recordResult(true);

  if (isLast) {
    // Plan exhausted -> software ceiling. Promote to C5 and escalate.
    const toC5 = governor.checkAdvance(claim.maturity, PRE_HARDWARE_CEILING);
    if (toC5.allowed) claim.maturity = PRE_HARDWARE_CEILING;
    claim.software_ceiling_reached = true;
    store.saveClaim(claim);
    store.log({ event: 'software_ceiling', claim_id: claim.claim_id, maturity: claim.maturity });
    return {
      type: 'escalation',
      category: 'SOFTWARE_CEILING_REACHED',
      claim_id: claim.claim_id,
      detail: `evidence plan exhausted across ${[...passedFamilies].length} world families; hardware required to progress`,
      digest: machineDigest({
        category: 'SOFTWARE_CEILING_REACHED',
        claim,
        evidence: evidenceSummary(store, claim.claim_id),
        detail: 'all software-testable steps satisfied',
      }),
    };
  }

  store.saveClaim(claim);
  store.log({ event: 'step_advanced', claim_id: claim.claim_id, step: step.id, to: step.advance_to });
  return { type: 'advance', claim_id: claim.claim_id, step: step.id, maturity: claim.maturity };
}

// Run one preregistered experiment and persist a signed receipt.
function runExperiment(store, governor, keys, env, spec) {
  const experiment = { estimated_runtime_minutes: (spec.seed_count / 120) * 0.2 };
  const gate = governor.checkExecution(experiment, env);
  if (!gate.allowed) return { type: 'halt', reason: 'resource_limit_reached', detail: gate.reasons };

  const protocol = preregister(spec);
  store.savePreregistered(protocol);
  if (store.getReceipt(protocol.experiment_id)) {
    return { type: 'halt', reason: 'duplicate_experiment', experiment_id: protocol.experiment_id };
  }

  const execResult = execute(protocol);
  const review = critique(execResult);
  const reproduction = reproduce(protocol, execResult);

  const receipt = signReceipt(
    buildReceipt({
      experiment_id: protocol.experiment_id,
      claim_id: spec.claim_id,
      step_id: spec.step_id,
      advance_to: spec.advance_to,
      world_family: spec.world_family,
      challenge_set: spec.challenge_set,
      provenance_class: spec.provenance_class,
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
    }),
    keys.privateKey
  );
  store.saveReceipt(receipt);
  store.completeProtocol(protocol.experiment_id);
  store.log({
    event: 'experiment_complete',
    experiment_id: protocol.experiment_id,
    claim_id: spec.claim_id,
    world: spec.world_family,
    result: execResult.result,
    reproduction: reproduction.status,
    red_team: review.verdict,
  });

  return {
    type: 'experiment',
    experiment_id: protocol.experiment_id,
    claim_id: spec.claim_id,
    world_family: spec.world_family,
    challenge_set: spec.challenge_set,
    result: execResult.result,
    reproduction: reproduction.status,
    red_team: review.verdict,
    metrics: execResult.primary_metrics,
  };
}

export function step(store, governor, keys, env) {
  const claims = claimsByPriority(store.listClaims());
  const receipts = store.listReceipts();

  // 1. Resolve any claim whose current step is fully run.
  for (const claim of claims) {
    const step = currentStep(claim);
    if (!step) continue;
    if (step.worlds.some((w) => !require_world_exists(w))) continue; // missing worlds handled below
    const { remaining } = worldStatus(receipts, claim, step);
    if (remaining.length === 0) {
      return resolveStep(store, governor, claim, step, receipts);
    }
  }

  // 1b. A claim whose next step requires NON-autonomous evidence (recorded
  // hardware, human labels, external data) cannot be run by the loop — it must
  // escalate to the correct human/hardware gate rather than fabricate evidence.
  for (const claim of claims) {
    const step = currentStep(claim);
    if (!step || !step.provenance_class || isAutonomous(step.provenance_class)) continue;
    claim.blocked = true;
    store.saveClaim(claim);
    const category = ingestEscalationFor(step.provenance_class) || 'NEEDS_HARDWARE';
    store.log({ event: 'provenance_gate', claim_id: claim.claim_id, provenance: step.provenance_class, category });
    return {
      type: 'escalation',
      category,
      claim_id: claim.claim_id,
      detail: `step ${step.id} requires ${step.provenance_class} evidence (human/hardware-gated); the autonomous loop cannot produce it`,
      digest: machineDigest({ category, claim, evidence: evidenceSummary(store, claim.claim_id), detail: `requires ${step.provenance_class}` }),
    };
  }

  // 2. Run the next highest-information experiment (or handle a missing world).
  const sel = selectNext(claims, receipts);
  if (!sel) return { type: 'terminal', reason: 'all_testable_claims_resolved' };

  if (sel.kind === 'missing_world') {
    const claim = store.getClaim(sel.claim_id);
    claim.blocked = true;
    store.saveClaim(claim);
    store.log({ event: 'missing_world', claim_id: claim.claim_id, worlds: sel.worlds });
    return {
      type: 'escalation',
      category: 'NEEDS_NEW_SIMULATOR',
      claim_id: claim.claim_id,
      detail: `no simulator world for: ${sel.worlds.join(', ')}`,
      digest: machineDigest({
        category: 'NEEDS_NEW_SIMULATOR',
        claim,
        evidence: evidenceSummary(store, claim.claim_id),
        detail: `required world(s) ${sel.worlds.join(', ')} not in the simulator registry`,
      }),
    };
  }

  return runExperiment(store, governor, keys, env, sel.spec);
}

function require_world_exists(w) {
  return ALL_WORLDS.includes(w);
}

export function runCampaign(opts = {}) {
  const dataDir = opts.dataDir || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
  const store = createStore(dataDir);
  const governor = createGovernor();
  const keys = ensureKeys(store.dirs.keys);
  const env = runtimeEnv(opts.env);
  const maxSteps = opts.maxSteps ?? 500;

  const steps = [];
  const escalations = [];
  let stop = null;
  for (let i = 0; i < maxSteps; i++) {
    const s = step(store, governor, keys, env);
    steps.push(s);
    if (s.type === 'escalation') escalations.push(s);
    if (s.type === 'terminal' || s.type === 'halt') {
      stop = s;
      break;
    }
  }
  if (!stop) stop = { type: 'halt', reason: 'max_steps_reached' };

  return {
    steps,
    escalations,
    stop,
    ceiling: PRE_HARDWARE_CEILING,
    diversity: diversityReport(store.listReceipts()),
    governor_counters: governor.counters,
    dataDir,
  };
}
