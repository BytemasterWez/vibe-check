#!/usr/bin/env node

// research_lab smoke test (cross-world edition). Offline, deterministic. Proves
// the loop and its safety invariants end to end:
//
//   1. determinism of RNG + simulator worlds
//   2. structurally different worlds; target-absent has no target
//   3. the ensemble recovers clean rates, abstains on an empty scene; the
//      overfit template never abstains (invents a rate on empty scenes)
//   4. the statistician bounds coverage and counts target-absent false positives
//   5. provenance: only simulated evidence is autonomous
//   6. blind challenges: the selector-facing surface hides the perturbation schedule
//   7. preregistration freeze + tamper detection
//   8. the governor blocks forbidden actions, the C5 ceiling, and gates on hard
//      safety constraints (utility can never buy back a dangerous error class)
//   9. executor no-leak + EXACT reproduction
//  10. a small campaign advances across world families, FALSIFIES a claim that
//      fails one world, and escalates NEEDS_NEW_SIMULATOR for a missing world

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';

import { createRng } from '../lib/rng.mjs';
import { generateWorld, ALL_WORLDS, RESPIRATORY_WORLDS } from '../lib/simulators/index.mjs';
import { runEstimator } from '../lib/estimators/index.mjs';
import { scoreTrials } from '../lib/statistician.mjs';
import { perturb } from '../lib/simulator_b.mjs';
import { loadEnsembleConfig, computeConfigHash } from '../lib/estimators/ensemble_config.mjs';
import { detectAmbiguity } from '../lib/detectors/ambiguity.mjs';
import { isAutonomous, ingestEscalationFor } from '../lib/provenance.mjs';
import { CHALLENGE_PUBLIC } from '../lib/challenges.mjs';
import { preregister, protocolIntact } from '../lib/prereg.mjs';
import { createGovernor } from '../lib/governor.mjs';
import { evaluateHardConstraints } from '../lib/constraints.mjs';
import { execute } from '../lib/executor.mjs';
import { reproduce } from '../lib/reproducer.mjs';
import { createStore } from '../lib/store.mjs';
import { runCampaign } from '../lib/orchestrator.mjs';

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed++;
  console.log(`  ok  ${name}`);
}

console.log('research_lab smoke test\n');

// --- 1/2. Determinism + worlds --------------------------------------------
console.log('worlds');
{
  const a = createRng(7);
  const b = createRng(7);
  check('same-seed RNG matches', a.gaussian() === b.gaussian());
  check('>= 3 structurally different respiratory worlds', RESPIRATORY_WORLDS.length >= 3);
  const t1 = generateWorld('biomechanical', 123);
  const t2 = generateWorld('biomechanical', 123);
  check('world generation is deterministic', JSON.stringify(t1.channels) === JSON.stringify(t2.channels));
  const absent = generateWorld('target_absent', 5);
  check('target-absent world has no target', absent.ground_truth.target_present === false && absent.ground_truth.true_rr_bpm === null);
}

// --- 3. Estimators recover / abstain / overfit -----------------------------
console.log('estimators');
{
  const clean = generateWorld('nonstationary', 321);
  const out = runEstimator('robust_ensemble_v1', clean, {});
  check('ensemble recovers a clean rate within 2 bpm', !out.abstained && Math.abs(out.rr_bpm - clean.ground_truth.true_rr_bpm) < 2);

  let ensembleFP = 0;
  let overfitFP = 0;
  for (let i = 0; i < 40; i++) {
    const absent = generateWorld('target_absent', 900 + i);
    if (!runEstimator('robust_ensemble_v1', absent, {}).abstained) ensembleFP++;
    if (!runEstimator('sinusoid_template_v1', absent, {}).abstained) overfitFP++;
  }
  check('ensemble abstains on empty scenes', ensembleFP === 0);
  check('overfit template invents a rate on empty scenes', overfitFP === 40);
}

// --- 3b. Observational independence + ambiguity gate (Packet 3) -------------
console.log('observational independence');
{
  const clean = generateWorld('sinusoidal', 4242);
  check('worlds expose a second spatial channel', Array.isArray(clean.channels.displacement_b) && clean.channels.displacement_b.length === clean.channels.displacement.length);
  check('ambiguity detector is quiet on a clean single source', !detectAmbiguity(clean, {}).ambiguous);

  // A spatially-distinct second person should trip the ambiguity detector.
  let tripped = 0;
  const N = 60;
  for (let i = 0; i < N; i++) {
    const t = perturb(generateWorld('biomechanical', 5000 + i), ['second_person_distinct'], 71);
    if (detectAmbiguity(t, {}).ambiguous) tripped++;
  }
  check('ambiguity detector fires on distinct-range intruders (>=90%)', tripped / N >= 0.9);

  // v2 resolves the distinct intruder where v1 misattributes (biomechanical).
  const scoreV = (est) => {
    const trials = [];
    for (let i = 0; i < 120; i++) {
      const t = perturb(generateWorld('biomechanical', 5000 + i), ['second_person_distinct'], 71);
      trials.push({ output: runEstimator(est, t, {}), ground_truth: t.ground_truth });
    }
    return scoreTrials(trials).false_confident_rate;
  };
  const fcrV1 = scoreV('robust_ensemble_v1');
  const fcrV2 = scoreV('robust_ensemble_v2');
  check('v2 abstains on distinct intruders where v1 misattributes', fcrV2 === 0 && fcrV1 > fcrV2);
}

// --- 3c. Frozen versioned ensemble config (Packet 3) -----------------------
console.log('frozen ensemble config');
{
  const cfg = loadEnsembleConfig();
  check('ensemble config loads with a verified hash', cfg.ensemble_version === '1.0.0' && cfg.config_hash === computeConfigHash(cfg));
  check('editing the config changes its hash (new version required)', computeConfigHash({ ...cfg, agreement_tolerance_bpm: 3.0 }) !== cfg.config_hash);
  const out = runEstimator('robust_ensemble_v2', generateWorld('sinusoidal', 7), {});
  check('v2 stamps outputs with the frozen ensemble version + hash', out.ensemble_version === cfg.ensemble_version && out.config_hash === cfg.config_hash);
}

// --- 4. Statistician bounds + target-absent FP -----------------------------
console.log('statistician');
{
  const trials = [
    { output: { abstained: false, rr_bpm: 12 }, ground_truth: { target_present: true, recoverable: true, true_rr_bpm: 12.1 } },
    { output: { abstained: false, rr_bpm: 18 }, ground_truth: { target_present: false, recoverable: false, true_rr_bpm: null } },
    { output: { abstained: true, rr_bpm: null }, ground_truth: { target_present: false, recoverable: false, true_rr_bpm: null } },
  ];
  const m = scoreTrials(trials);
  check('coverage within [0,1]', m.valid_coverage >= 0 && m.valid_coverage <= 1);
  check('target-absent false positive counted', m.target_absent_false_positive_rate === 0.5);
  check('utility penalizes danger', m.utility < m.valid_coverage);
}

// --- 5. Provenance ----------------------------------------------------------
console.log('provenance');
{
  check('simulated evidence is autonomous', isAutonomous('simulated'));
  check('recorded-hardware needs escalation', ingestEscalationFor('recorded_hardware') === 'NEEDS_HARDWARE');
}

// --- 6. Blind challenges ----------------------------------------------------
console.log('challenges');
{
  const anyHiddenExposed = Object.values(CHALLENGE_PUBLIC).some((c) => 'perturbation_schedule' in c || 'salt' in c);
  check('selector-facing challenge metadata hides the hidden schedule', !anyHiddenExposed);
}

// --- 7. Preregistration freeze ---------------------------------------------
console.log('preregistration');
let protocol;
{
  const spec = {
    claim_id: 'CLM-RR-001',
    step_id: 'c3_clean',
    advance_to: 'C3',
    world_family: 'sinusoidal',
    challenge_set: 'clean',
    provenance_class: 'simulated',
    candidate: 'robust_ensemble_v1',
    baseline: 'fft_peak_v1',
    seed_start: 700000,
    seed_count: 24,
    acceptance: { mae_max: 2, coverage_min: 0.9, false_confident_max: 0.02, utility_min: 0.8 },
    hypothesis: 'x',
  };
  protocol = preregister(spec);
  check('protocol carries a freeze hash', protocol.protocol_hash.startsWith('sha256:'));
  check('frozen protocol verifies intact', protocolIntact(protocol));
  check('threshold edit after freeze is detected', !protocolIntact({ ...protocol, acceptance: { ...protocol.acceptance, mae_max: 999 } }));
}

// --- 8. Governor + hard constraints ----------------------------------------
console.log('governor + constraints');
{
  const cleanCtx = { false_confident_rate: 0, target_absent_false_positive_rate: 0, reproduction_status: 'EXACT_MATCH', critical_scenario_coverage: 1 };
  const gov = createGovernor();
  check('forbidden action blocked + escalated', gov.checkAction('purchase_hardware').escalate === true);
  check('hard constraints pass on clean evidence', gov.checkHardConstraints(cleanCtx).pass === true);
  check('advance past C5 ceiling blocked', gov.checkAdvance('C5', 'C6').allowed === false);
  check('ceiling breach increments unsupported-promotion counter', gov.counters.unsupported_promotion_attempts === 1);
  check('governor injects its own counter — clean metrics now fail after a breach', gov.checkHardConstraints(cleanCtx).pass === false);

  const clean = evaluateHardConstraints(cleanCtx);
  check('constraints module passes clean evidence', clean.pass === true);
  const danger = evaluateHardConstraints({ ...cleanCtx, false_confident_rate: 0.02 });
  check('a dangerous false-confident rate fails hard constraints', danger.pass === false);
}

// --- 9. Executor no-leak + reproduction ------------------------------------
console.log('executor + reproducer');
let execResult;
{
  execResult = execute(protocol);
  check('leakage check is clean', execResult.leakage_check === 'clean');
  check('clean experiment passed', execResult.result === 'PASSED');
  check('experiment reproduces EXACTLY', reproduce(protocol, execResult).status === 'EXACT_MATCH');
}

// --- 10. Small cross-world campaign ----------------------------------------
console.log('cross-world campaign');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'research-lab-xw-'));
  const store = createStore(path.join(tmp, 'data'));

  // A robust claim that should advance across two world families.
  store.saveClaim(mkClaim('CLM-A', 'robust_ensemble_v1', [
    step('s1', 'C3', 'clean', ['sinusoidal', 'nonstationary'], 2, 800000, 24),
  ]));
  // An overfit candidate that should be FALSIFIED on the target-absent world.
  store.saveClaim(mkClaim('CLM-B', 'sinusoid_template_v1', [
    step('s1', 'C4', 'target_absent', ['target_absent'], 1, 810000, 200, { target_absent_fp_max: 0.001 }),
  ]));
  // A claim needing a world the registry does not have.
  store.saveClaim(mkClaim('CLM-C', 'robust_ensemble_v1', [
    step('s1', 'C3', 'clean', ['no_such_world'], 1, 820000, 24),
  ]));

  const res = runCampaign({ dataDir: store.dataDir, maxSteps: 100 });
  const a = store.getClaim('CLM-A');
  const b = store.getClaim('CLM-B');
  const c = store.getClaim('CLM-C');
  check('robust claim advanced across world families', a.completed_steps.includes('s1') && a.maturity !== 'C2');
  check('overfit claim on empty scenes is FALSIFIED', b.falsified === true);
  check('missing-world claim is blocked', c.blocked === true);
  check('NEEDS_NEW_SIMULATOR escalation raised', res.escalations.some((e) => e.category === 'NEEDS_NEW_SIMULATOR'));
  check('CLAIM_FALSIFIED escalation raised', res.escalations.some((e) => e.category === 'CLAIM_FALSIFIED'));
  check('campaign reaches a clean terminal', res.stop.type === 'terminal');
  check('no unsupported promotions occurred', res.governor_counters.unsupported_promotion_attempts === 0);
  check('every world referenced by CLM-A exists', ['sinusoidal', 'nonstationary'].every((w) => ALL_WORLDS.includes(w)));
}

console.log(`\n${passed} checks passed.`);

// --- helpers ---------------------------------------------------------------
function step(id, advance_to, challenge_set, worlds, min_families, seed_start, seed_count, extra = {}) {
  return {
    id,
    advance_to,
    challenge_set,
    worlds,
    min_families,
    seed_start,
    seed_count,
    acceptance: { mae_max: 2, coverage_min: 0.9, false_confident_max: 0.02, utility_min: 0.8, ...extra },
  };
}
function mkClaim(claim_id, candidate, steps) {
  return {
    claim_id,
    statement: claim_id,
    clinical_relevance: 1,
    candidate_estimator: candidate,
    baseline_estimator: 'fft_peak_v1',
    maturity: 'C2',
    open_uncertainties: [],
    evidence_plan: { steps },
    supporting_experiments: [],
    contradicting_experiments: [],
    completed_steps: [],
  };
}
