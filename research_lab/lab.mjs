#!/usr/bin/env node
// research_lab — Autonomous Pre-Hardware Sensing Laboratory CLI.
//
// A deterministic closed research loop: it maintains a claim ledger, designs and
// preregisters falsification experiments, executes them in isolation against
// frozen criteria, red-teams and reproduces the results, and advances claim
// maturity — never past the pre-hardware ceiling (C5). AI is not on the critical
// path; every gate here is code.
//
//   node research_lab/lab.mjs seed [--reset]     seed the ledger from the registry
//   node research_lab/lab.mjs status             ledger + experiment summary
//   node research_lab/lab.mjs plan               ranked next experiments (info gain)
//   node research_lab/lab.mjs run [--max N]      run the loop to a terminal state
//   node research_lab/lab.mjs receipt <exp_id>   show a signed experiment receipt
//   node research_lab/lab.mjs reproduce <exp_id> rerun from the frozen protocol
//   node research_lab/lab.mjs digest <claim_id>  one-decision escalation digest

import path from 'path';
import { fileURLToPath } from 'url';
import { createStore } from './lib/store.mjs';
import { ensureKeys, verifyReceiptSignature } from './lib/receipts.mjs';
import { seed, summarize, decisionDigest } from './lib/ledger.mjs';
import { rankAll } from './lib/selector.mjs';
import { runCampaign } from './lib/orchestrator.mjs';
import { preregister } from './lib/prereg.mjs';
import { reproduce } from './lib/reproducer.mjs';
import fs from 'fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.RESEARCH_LAB_DATA || path.join(HERE, 'data');

function store() {
  return createStore(DATA_DIR);
}

function arg(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const cmd = process.argv[2] || 'status';
const s = store();

switch (cmd) {
  case 'seed': {
    const reset = process.argv.includes('--reset');
    const seeded = seed(s, { reset });
    console.log(`Seeded ${seeded.length} claim(s)${reset ? ' (reset)' : ''}: ${seeded.join(', ') || '(none new)'}`);
    break;
  }

  case 'status': {
    const sum = summarize(s);
    console.log(`Pre-hardware ceiling: ${sum.ceiling}`);
    console.log(`Experiments: ${sum.experiments.total} (passed ${sum.experiments.passed}, failed ${sum.experiments.failed})\n`);
    for (const c of sum.claims) {
      console.log(`${c.claim_id}  [${c.maturity} ${c.maturity_name}]`);
      console.log(`  ${c.statement}`);
      console.log(`  support ${c.supporting}  contradict ${c.contradicting}  open: ${c.open_uncertainties.join(', ') || 'none'}`);
    }
    break;
  }

  case 'plan': {
    const claims = s.listClaims();
    const completed = new Set(s.listReceipts().map((r) => `${r.claim_id}:${r.family}:${r.candidate}`));
    const ranked = rankAll(claims, completed);
    if (!ranked.length) {
      console.log('No software-testable experiments remain (all claims at ceiling or resolved).');
      break;
    }
    for (const r of ranked) {
      const p = preregister({ claim_id: r.claim_id, ...r.spec });
      console.log(`${p.experiment_id}  priority=${r.priority.toFixed(3)}  ${r.claim_id} -> ${r.target} (${r.family})`);
      console.log(`  ${r.spec.hypothesis}`);
    }
    break;
  }

  case 'run': {
    if (!s.listClaims().length) seed(s);
    const max = parseInt(arg('--max', '100'), 10);
    const result = runCampaign({ dataDir: DATA_DIR, maxSteps: max });
    for (const st of result.steps) {
      if (st.type === 'experiment') {
        console.log(
          `${st.experiment_id}  ${st.result}  ${st.claim_id} ${st.maturity_change}  ` +
            `repro=${st.reproduction} redteam=${st.red_team} mae=${st.metrics.mae_bpm} ` +
            `cov=${st.metrics.valid_coverage} fcr=${st.metrics.false_confident_rate} util=${st.metrics.utility}`
        );
      } else {
        console.log(`[${st.type}] ${st.reason}${st.claim_id ? ' (' + st.claim_id + ')' : ''}`);
      }
    }
    console.log(`\nStopped: ${result.stop.type} — ${result.stop.reason}`);
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
    const sig = verifyReceiptSignature(r, publicKey);
    console.log(JSON.stringify(r, null, 2));
    console.log(`\nsignature: ${sig.valid ? 'VALID' : 'INVALID'} — ${sig.reason}`);
    break;
  }

  case 'reproduce': {
    const id = process.argv[3];
    const receipt = s.getReceipt(id);
    if (!receipt) {
      console.error(`no receipt for ${id}`);
      process.exit(1);
    }
    // Rebuild the exact frozen protocol from the receipt + registry spec is not
    // needed: the completed protocol is retained on disk.
    const completedPath = path.join(s.dirs.protocols_completed, `${id}.json`);
    if (!fs.existsSync(completedPath)) {
      console.error(`no retained protocol for ${id}`);
      process.exit(1);
    }
    const protocol = JSON.parse(fs.readFileSync(completedPath, 'utf-8'));
    const rep = reproduce(protocol, receipt);
    console.log(JSON.stringify(rep, null, 2));
    break;
  }

  case 'digest': {
    const claimId = process.argv[3];
    if (!s.getClaim(claimId)) {
      console.error(`no claim ${claimId}`);
      process.exit(1);
    }
    console.log(decisionDigest(s, claimId));
    break;
  }

  default:
    console.error(`unknown command: ${cmd}`);
    console.error('commands: seed | status | plan | run | receipt | reproduce | digest');
    process.exit(1);
}
