#!/usr/bin/env node
// research_lab — Autonomous Pre-Hardware Sensing Laboratory CLI.
//
// A deterministic closed research loop that maintains a claim ledger, designs
// and preregisters cross-world falsification experiments, executes them against
// frozen criteria, red-teams and reproduces the results, and advances claim
// maturity — never past the pre-hardware ceiling (C5), and never on evidence
// from a single simulator world family. AI is not on the critical path.
//
//   node research_lab/lab.mjs seed [--reset]     seed the ledger from the registry
//   node research_lab/lab.mjs status             ledger + experiment summary
//   node research_lab/lab.mjs plan               ranked next experiments (info gain)
//   node research_lab/lab.mjs run [--max N]      run the loop to a terminal state
//   node research_lab/lab.mjs diversity          campaign diversity report
//   node research_lab/lab.mjs brief <claim_id> [--json]   one-decision escalation
//   node research_lab/lab.mjs receipt <exp_id>   show a signed experiment receipt
//   node research_lab/lab.mjs reproduce <exp_id> rerun from the frozen protocol

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createStore } from './lib/store.mjs';
import { ensureKeys, verifyReceiptSignature } from './lib/receipts.mjs';
import { seed, summarize, brief, machineBrief } from './lib/ledger.mjs';
import { rankAll } from './lib/selector.mjs';
import { runCampaign } from './lib/orchestrator.mjs';
import { reproduce } from './lib/reproducer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.RESEARCH_LAB_DATA || path.join(HERE, 'data');

function arg(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const cmd = process.argv[2] || 'status';
const s = createStore(DATA_DIR);

switch (cmd) {
  case 'seed': {
    const seeded = seed(s, { reset: process.argv.includes('--reset') });
    console.log(`Seeded ${seeded.length} claim(s): ${seeded.join(', ') || '(none new)'}`);
    break;
  }

  case 'status': {
    const sum = summarize(s);
    console.log(`Pre-hardware ceiling: ${sum.ceiling}`);
    console.log(`Experiments: ${sum.experiments.total} (passed ${sum.experiments.passed}, failed ${sum.experiments.failed})\n`);
    for (const c of sum.claims) {
      console.log(`${c.claim_id}  [${c.maturity} ${c.maturity_name}]  ${c.state}  steps ${c.steps_completed}/${c.steps_total}`);
      console.log(`  ${c.statement}`);
      console.log(`  support ${c.supporting}  contradict ${c.contradicting}  open: ${c.open_uncertainties.join(', ') || 'none'}`);
    }
    break;
  }

  case 'plan': {
    const ranked = rankAll(s.listClaims(), s.listReceipts());
    if (!ranked.length) {
      console.log('No runnable experiments (all claims resolved, blocked, or awaiting a quorum decision).');
      break;
    }
    for (const r of ranked) {
      console.log(`${r.claim_id} ${r.step_id} @ ${r.world}  priority=${r.priority.toFixed(3)} -> ${r.spec.advance_to}`);
    }
    break;
  }

  case 'run': {
    if (!s.listClaims().length) seed(s);
    const max = parseInt(arg('--max', '500'), 10);
    const result = runCampaign({ dataDir: DATA_DIR, maxSteps: max });
    for (const st of result.steps) {
      if (st.type === 'experiment') {
        console.log(
          `  exp ${st.claim_id}@${st.world_family}/${st.challenge_set}  ${st.result}  ` +
            `repro=${st.reproduction} redteam=${st.red_team} ` +
            `mae=${st.metrics.mae_bpm} cov=${st.metrics.valid_coverage} fcr=${st.metrics.false_confident_rate} taFP=${st.metrics.target_absent_false_positive_rate}`
        );
      } else if (st.type === 'advance') {
        console.log(`  ++ ${st.claim_id} advanced (${st.step}) -> ${st.maturity}`);
      } else if (st.type === 'escalation') {
        console.log(`  !! ESCALATION ${st.category}: ${st.claim_id} — ${st.detail}`);
      } else {
        console.log(`  [${st.type}] ${st.reason}`);
      }
    }
    console.log(`\nEscalations: ${result.escalations.length}`);
    console.log(`Governor counters: ${JSON.stringify(result.governor_counters)}`);
    console.log(`Stopped: ${result.stop.type} — ${result.stop.reason}`);
    break;
  }

  case 'diversity': {
    const { diversityReport } = await import('./lib/diversity.mjs');
    console.log(JSON.stringify(diversityReport(s.listReceipts()), null, 2));
    break;
  }

  case 'brief': {
    const claimId = process.argv[3];
    if (!claimId || !s.getClaim(claimId)) {
      console.error(`usage: brief <claim_id>  (unknown claim ${claimId})`);
      process.exit(1);
    }
    if (process.argv.includes('--json')) console.log(JSON.stringify(machineBrief(s, claimId), null, 2));
    else console.log(brief(s, claimId));
    break;
  }

  case 'receipt': {
    const id = process.argv[3];
    const r = s.getReceipt(id);
    if (!r) {
      console.error(`no receipt for ${id}`);
      process.exit(1);
    }
    const { publicKey } = ensureKeys(s.dirs.keys);
    console.log(JSON.stringify(r, null, 2));
    console.log(`\nsignature: ${verifyReceiptSignature(r, publicKey).valid ? 'VALID' : 'INVALID'}`);
    break;
  }

  case 'reproduce': {
    const id = process.argv[3];
    const receipt = s.getReceipt(id);
    const completedPath = path.join(s.dirs.protocols_completed, `${id}.json`);
    if (!receipt || !fs.existsSync(completedPath)) {
      console.error(`no retained protocol/receipt for ${id}`);
      process.exit(1);
    }
    const protocol = JSON.parse(fs.readFileSync(completedPath, 'utf-8'));
    console.log(JSON.stringify(reproduce(protocol, receipt), null, 2));
    break;
  }

  default:
    console.error(`unknown command: ${cmd}`);
    console.error('commands: seed | status | plan | run | diversity | brief | receipt | reproduce');
    process.exit(1);
}
