#!/usr/bin/env node

// External-evidence framework test. Proves the ingestion plumbing before any
// real dataset exists:
//   1. a well-formed recording passes the adapter contract and reproduces exactly
//   2. a corrupted normalized hash is caught
//   3. a silent (undeclared) transformation is caught
//   4. a truth leak into estimator input is caught
//   5. eligibility rejects unusable datasets with EVIDENCE_INELIGIBLE + reasons
//   6. subject/session split leakage is detected
//   7. the estimator can run label-blind on the ingested input
//   8. the autonomous loop cannot self-advance the external maturity track
//   9. E3 (cross-dataset) needs >= 2 independently acquired datasets

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { makeFixtureRecording } from '../lib/external/fixture.mjs';
import { validateAdapter, reproductionExact } from '../lib/external/contract.mjs';
import { checkEligibility, checkSubjectSplit } from '../lib/external/eligibility.mjs';
import { externalAdvanceGate, requiresHumanGate } from '../lib/external/maturity.mjs';
import { evaluateExternal, OUTCOMES } from '../lib/external/evaluate.mjs';
import { runEstimator } from '../lib/estimators/index.mjs';

let passed = 0;
const check = (name, cond) => {
  assert.ok(cond, name);
  passed++;
  console.log(`  ok  ${name}`);
};

console.log('external-evidence framework test\n');

// 1. Well-formed recording.
console.log('adapter contract');
{
  const rec = makeFixtureRecording({ seed: 3 });
  const res = validateAdapter(rec);
  check('valid recording passes the adapter contract', res.pass);
  check('adapter reproduction is exact', reproductionExact(rec));
}

// 2-4. Corruptions caught.
{
  check('corrupted normalized hash is caught', !validateAdapter(makeFixtureRecording({ seed: 3, corrupt: 'hash' })).pass);
  check('silent undeclared transformation is caught', !validateAdapter(makeFixtureRecording({ seed: 3, corrupt: 'undeclared' })).pass);
  const leak = validateAdapter(makeFixtureRecording({ seed: 3, corrupt: 'leak' }));
  check('truth leak into estimator input is caught', !leak.pass && leak.violations.some((v) => v.includes('leaked')));
}

// 5. Eligibility.
console.log('eligibility');
{
  const good = makeFixtureRecording({ seed: 4 });
  // A real external class is required; the fixture defaults to public_dataset.
  check('a well-formed public dataset is eligible', checkEligibility(good.manifest, good.subjects).eligible);
  const bad = makeFixtureRecording({ seed: 4, ineligible: 'license' });
  const badRes = checkEligibility(bad.manifest, bad.subjects);
  check('unusable licence yields EVIDENCE_INELIGIBLE', badRes.status === 'EVIDENCE_INELIGIBLE' && badRes.reasons.length > 0);
  const sim = makeFixtureRecording({ seed: 4, ineligible: 'simulated' });
  check('simulated data is inadmissible as external evidence', !checkEligibility(sim.manifest, sim.subjects).eligible);
  const short = makeFixtureRecording({ seed: 4, ineligible: 'short' });
  check('too-short recording is ineligible', !checkEligibility(short.manifest, short.subjects).eligible);
}

// 6. Subject split leakage.
console.log('split protection');
{
  const clean = makeFixtureRecording({ seed: 5 });
  check('disjoint subjects pass the split check', checkSubjectSplit(clean.subjects).clean);
  const leaky = makeFixtureRecording({ seed: 5, splitLeak: true });
  const split = checkSubjectSplit(leaky.subjects);
  check('same subject across splits is detected', !split.clean && split.leaks[0].subject_id === 'S5');
}

// 7. Label-blind execution.
console.log('label-blind execution');
{
  const rec = makeFixtureRecording({ seed: 6 });
  // Give the estimator a two-channel view (external has one channel; mirror it).
  const input = { channels: { displacement: rec.input.channels.displacement, displacement_b: rec.input.channels.displacement, imu: rec.input.channels.displacement.map(() => 0) }, fs_hz: rec.input.fs_hz };
  const out = runEstimator('robust_ensemble_v1', input, {});
  check('estimator input carries no truth field', !('true_rr_bpm' in input) && !('true_rr_bpm' in input.channels));
  check('estimator runs on ingested input and returns a decision', out && out.abstained !== undefined);
}

// 8-9. External maturity gating.
console.log('external maturity');
{
  const auto = externalAdvanceGate({ to: 'E1-EXTERNAL-REPLAY', autonomous: true, datasets: [{ source: 'x' }] });
  check('autonomous loop cannot self-advance to E1', !auto.allowed && auto.escalate === 'NEEDS_EXTERNAL_DATASET');
  check('E-levels require a human gate', requiresHumanGate('E1-EXTERNAL-REPLAY') && requiresHumanGate('H1-BENCH-HARDWARE'));
  const oneDataset = externalAdvanceGate({ to: 'E3-CROSS-DATASET', autonomous: false, datasets: [{ source: 'a' }] });
  check('E3 rejected with a single dataset', !oneDataset.allowed);
  const twoDatasets = externalAdvanceGate({ to: 'E3-CROSS-DATASET', autonomous: false, datasets: [{ source: 'a' }, { source: 'b' }] });
  check('E3 allowed (human) with two independent datasets', twoDatasets.allowed);
}

// 10. End-to-end evaluation pipeline + outcome taxonomy.
console.log('evaluation pipeline (outcomes may disappoint)');
{
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl- exteval-'.replace(' ', '')));
  const singleChannelClaim = { claim_id: 'EXT-RR-DEMO', required_modalities: ['mmwave'], candidate_estimator: 'robust_ensemble_v1', acceptance: { mae_max: 2 } };
  const spatialClaim = { claim_id: 'EXT-RR-SPATIAL', required_modalities: ['mmwave_2channel'], candidate_estimator: 'robust_ensemble_v2', acceptance: { mae_max: 2 } };

  const good = makeFixtureRecording({ seed: 7 });
  const r = evaluateExternal(good, singleChannelClaim, { workDir });
  check('eligible recording + applicable claim yields PASS/ABSTAIN', ['PASS', 'ABSTAIN'].includes(r.outcome));
  check('external receipt binds raw + normalized hashes', r.raw_bundle_sha256 && r.normalized_bundle_sha256);
  check('truth isolation is verified', r.truth_isolation_verified === true);

  check('a single-channel dataset is CLAIM_NOT_APPLICABLE for a spatial claim', evaluateExternal(makeFixtureRecording({ seed: 8 }), spatialClaim, { workDir }).outcome === 'CLAIM_NOT_APPLICABLE');
  check('an ineligible dataset yields EVIDENCE_INELIGIBLE', evaluateExternal(makeFixtureRecording({ seed: 9, ineligible: 'license' }), singleChannelClaim, { workDir }).outcome === 'EVIDENCE_INELIGIBLE');
  check('a declared-but-empty reference yields REFERENCE_UNUSABLE', evaluateExternal(makeFixtureRecording({ seed: 10, unusable_reference: true }), singleChannelClaim, { workDir }).outcome === 'REFERENCE_UNUSABLE');
  check('a corrupted adapter yields ADAPTER_INVALID', evaluateExternal(makeFixtureRecording({ seed: 11, corrupt: 'undeclared' }), singleChannelClaim, { workDir }).outcome === 'ADAPTER_INVALID');

  // signal_type is checked after the adapter contract, so flip only that field.
  const wrongSignal = makeFixtureRecording({ seed: 12 });
  wrongSignal.manifest.signal_type = 'audio_waveform';
  check('an incompatible signal type yields SIGNAL_TYPE_INCOMPATIBLE', evaluateExternal(wrongSignal, singleChannelClaim, { workDir }).outcome === 'SIGNAL_TYPE_INCOMPATIBLE');
  check('all outcomes are drawn from the frozen taxonomy', OUTCOMES.length === 8 && OUTCOMES.includes('CLAIM_NOT_APPLICABLE'));
}

console.log(`\n${passed} checks passed.`);
