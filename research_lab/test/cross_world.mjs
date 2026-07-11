#!/usr/bin/env node

// Cross-world proof milestone.
//
// The reviewer's bar: the laboratory becomes genuinely useful (not merely
// deterministic) once it can EXPOSE AND REJECT an estimator that performs
// brilliantly against one simulated world but fails against an independently
// constructed one. This test drives exactly that, and asserts the outcome.
//
// Two claims are brilliant on the clean sinusoidal step and are then taken into
// independent worlds:
//   * sinusoid_template_v1 (overfit, never abstains) -> invents vital signs on
//     the target-absent world -> FALSIFIED.
//   * robust_ensemble_v2 (ambiguity gate + agreeing members) -> survives an
//     independent adversarial world (distinct-range intruder) -> reaches ceiling.

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { createStore } from '../lib/store.mjs';
import { runCampaign } from '../lib/orchestrator.mjs';
import { generateWorld } from '../lib/simulators/index.mjs';
import { runEstimator } from '../lib/estimators/index.mjs';
import { scoreTrials } from '../lib/statistician.mjs';

function cleanMetrics(estimator, world, n = 60, start = 990000) {
  const trials = [];
  for (let i = 0; i < n; i++) {
    const t = generateWorld(world, start + i);
    trials.push({ output: runEstimator(estimator, t, {}), ground_truth: t.ground_truth });
  }
  return scoreTrials(trials);
}

// Both plans share a clean first step. The overfit is then exposed on the
// independent target-absent world (it invents rates -> many observed events ->
// falsified even at a small sample). The ensemble is instead taken through an
// independent adversarial world (a distinct-range intruder) that it survives and
// reaches its ceiling; the strict 0.001 target-absent bound is established in the
// main campaign (CLM-RR-003, 3200 trials), not re-proven at cost here.
function baseClaim(candidate, secondStep) {
  return {
    claim_id: `CLM-${candidate}`,
    statement: `probe: ${candidate}`,
    clinical_relevance: 1,
    candidate_estimator: candidate,
    baseline_estimator: 'fft_peak_v1',
    maturity: 'C2',
    open_uncertainties: [],
    evidence_plan: {
      steps: [
        { id: 's1_clean', advance_to: 'C3', challenge_set: 'clean', worlds: ['sinusoidal', 'biomechanical'], min_families: 2, seed_start: 960000, seed_count: 120, acceptance: { mae_max: 2, coverage_min: 0.9, false_confident_max: 0.02, utility_min: 0.8 } },
        secondStep,
      ],
    },
    supporting_experiments: [],
    contradicting_experiments: [],
    completed_steps: [],
  };
}
const overfitPlan = baseClaim('sinusoid_template_v1', {
  id: 's2_absent', advance_to: 'C4', challenge_set: 'target_absent', worlds: ['target_absent'], min_families: 1, seed_start: 970000, seed_count: 300, acceptance: { target_absent_fp_max: 0.001 },
});
const ensemblePlan = baseClaim('robust_ensemble_v2', {
  id: 's2_independent', advance_to: 'C4', challenge_set: 'intruder_distinct', worlds: ['sinusoidal', 'biomechanical'], min_families: 2, seed_start: 980000, seed_count: 120, acceptance: { false_confident_max: 0.05 },
});

console.log('cross-world proof milestone\n');

const overfitClean = cleanMetrics('sinusoid_template_v1', 'sinusoidal');
console.log(`sinusoid_template_v1 on clean sinusoidal:  mae=${overfitClean.mae_bpm} coverage=${overfitClean.valid_coverage} fcr=${overfitClean.false_confident_rate}`);
assert.ok(overfitClean.mae_bpm < 0.5 && overfitClean.valid_coverage === 1, 'overfit should be brilliant on its home world');
console.log('  -> brilliant on its home world.\n');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'research-lab-proof-'));
const store = createStore(path.join(tmp, 'data'));
store.saveClaim(overfitPlan); // fails on target-absent via observed events
store.saveClaim(ensemblePlan); // survives an independent adversarial world

const res = runCampaign({ dataDir: store.dataDir, maxSteps: 100 });

const overfit = store.getClaim('CLM-sinusoid_template_v1');
const ensemble = store.getClaim('CLM-robust_ensemble_v2');

console.log('outcome:');
console.log(`  overfit  : completed_steps=${JSON.stringify(overfit.completed_steps)} falsified=${!!overfit.falsified} maturity=${overfit.maturity}`);
console.log(`  ensemble : completed_steps=${JSON.stringify(ensemble.completed_steps)} ceiling=${!!ensemble.software_ceiling_reached} maturity=${ensemble.maturity}`);

let passed = 0;
const check = (n, c) => {
  assert.ok(c, n);
  passed++;
  console.log(`  ok  ${n}`);
};

console.log();
check('overfit passed the clean sinusoidal step (brilliant)', overfit.completed_steps.includes('s1_clean'));
check('overfit is FALSIFIED by the independent target-absent world', overfit.falsified === true);
check('overfit never reached its software ceiling', !overfit.software_ceiling_reached);
check('ensemble passed the clean step too', ensemble.completed_steps.includes('s1_clean'));
check('ensemble survived the independent world and reached its ceiling', ensemble.software_ceiling_reached === true);
check('the lab distinguished the two candidates', overfit.falsified === true && ensemble.software_ceiling_reached === true);
check('a CLAIM_FALSIFIED escalation names the overfit candidate', res.escalations.some((e) => e.category === 'CLAIM_FALSIFIED' && e.claim_id === 'CLM-sinusoid_template_v1'));
check('no unsupported promotions occurred', res.governor_counters.unsupported_promotion_attempts === 0);

console.log(`\n${passed} checks passed — the laboratory exposed and rejected the overfit estimator.`);
