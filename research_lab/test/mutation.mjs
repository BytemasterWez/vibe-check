#!/usr/bin/env node

// Mutation testing of the governance modules (build-packet §6).
//
// A guardrail is only real if a test would notice when it breaks. For each
// governance invariant we run the REAL implementation (which must satisfy the
// invariant) and a deliberately BROKEN mutant (which must violate it). A mutant
// that still satisfies every invariant has "survived" — meaning our tests do not
// actually constrain that guardrail, which is a failure. All mutants must be
// killed.

import { createGovernor } from '../lib/governor.mjs';
import { protocolIntact, preregister } from '../lib/prereg.mjs';
import { evaluateHardConstraints } from '../lib/constraints.mjs';
import { scoreTrials } from '../lib/statistician.mjs';
import { execute } from '../lib/executor.mjs';

let killed = 0;
let survived = 0;

// A mutant is killed when the invariant holds for the real fn but fails for the
// mutant. If the invariant fails for the real fn, the invariant itself is wrong.
function mutant(name, invariant, realFn, mutantFn) {
  const realOk = invariant(realFn);
  const mutantOk = invariant(mutantFn);
  if (!realOk) {
    console.log(`  BROKEN INVARIANT  ${name}: real implementation does not satisfy the invariant`);
    survived++;
    return;
  }
  if (mutantOk) {
    console.log(`  SURVIVED  ${name}: mutant not detected — guardrail is untested`);
    survived++;
    return;
  }
  console.log(`  killed    ${name}`);
  killed++;
}

console.log('governance mutation test\n');

// 1. Maturity-ceiling guard: must block any advance past C5.
const realCheckAdvance = (from, to) => createGovernor().checkAdvance(from, to);
mutant(
  'checkAdvance blocks past C5 ceiling',
  (fn) => fn('C5', 'C6').allowed === false && fn('C3', 'C4').allowed === true,
  realCheckAdvance,
  // Mutant: naively allows any upward advance, ignoring the ceiling.
  (from, to) => ({ allowed: to > from })
);

// 2. Protocol freeze integrity: must detect a post-freeze threshold edit.
{
  const proto = preregister({
    claim_id: 'CLM-X',
    step_id: 's',
    advance_to: 'C3',
    world_family: 'sinusoidal',
    challenge_set: 'clean',
    provenance_class: 'simulated',
    candidate: 'fft_peak_v1',
    baseline: 'fft_peak_v1',
    seed_start: 1,
    seed_count: 4,
    acceptance: { mae_max: 2 },
    hypothesis: 'x',
  });
  const tampered = { ...proto, acceptance: { ...proto.acceptance, mae_max: 999 } };
  mutant(
    'protocolIntact detects threshold tampering',
    (fn) => fn(proto) === true && fn(tampered) === false,
    protocolIntact,
    // Mutant: trusts the protocol blindly.
    () => true
  );

  // 2b. The executor must refuse to run a tampered protocol.
  mutant(
    'executor refuses a tampered protocol',
    (guard) => {
      // invariant: running a tampered protocol throws; running a clean one does not.
      let cleanRan = false;
      try {
        guard(proto);
        cleanRan = true;
      } catch {
        cleanRan = false;
      }
      let tamperedThrew = false;
      try {
        guard(tampered);
      } catch {
        tamperedThrew = true;
      }
      return cleanRan && tamperedThrew;
    },
    (p) => execute(p),
    // Mutant executor: skips the integrity check entirely.
    (p) => ({ ok: true, ignored: p.experiment_id })
  );
}

// 3. Hard constraints: must reject a dangerous false-confident count and must
//    not accept "zero failures in a small sample" as meeting a tight bound.
mutant(
  'hard constraints reject dangerous false confidence via a confidence bound',
  (fn) => {
    const base = { false_confident_count: 0, false_confident_trials: 4000, target_absent_false_positive_count: 0, target_absent_trials: 4000, reproduction_status: 'EXACT_MATCH', critical_scenario_coverage: 1 };
    const clean = fn(base).pass === true;
    const danger = fn({ ...base, false_confident_count: 3, false_confident_trials: 100 }).pass === false;
    const smallSample = fn({ ...base, target_absent_trials: 200 }).pass === false; // 0/200 can't reach 0.001
    return clean && danger && smallSample;
  },
  (ctx) => evaluateHardConstraints(ctx),
  // Mutant: treats a point rate of zero as proof, ignoring how few trials backed it.
  (ctx) => evaluateHardConstraints({ ...ctx, false_confident_count: 0, false_confident_trials: 1e9, target_absent_false_positive_count: 0, target_absent_trials: 1e9 })
);

// 4. Statistician: must count a confident output on an empty scene.
mutant(
  'statistician counts target-absent false positives',
  (fn) => {
    const trials = [{ output: { abstained: false, rr_bpm: 15 }, ground_truth: { target_present: false, recoverable: false, true_rr_bpm: null } }];
    return fn(trials).target_absent_false_positive_rate === 1;
  },
  (trials) => scoreTrials(trials),
  // Mutant: treats an abstain-less empty-scene output as harmless.
  (trials) => ({ ...scoreTrials(trials), target_absent_false_positive_rate: 0 })
);

console.log(`\n${killed} mutants killed, ${survived} survived.`);
if (survived > 0) {
  console.error('FAIL: at least one governance mutant survived — a guardrail is untested.');
  process.exit(1);
}
