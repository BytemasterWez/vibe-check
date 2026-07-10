#!/usr/bin/env node

// CapabilityProof CLI — run verification sweeps and inspect receipts locally.
//
//   node capabilityproof/cli.mjs list
//   node capabilityproof/cli.mjs verify <capability_id>
//   node capabilityproof/cli.mjs verify-all
//   node capabilityproof/cli.mjs search "<task>"
//   node capabilityproof/cli.mjs route "<task>"
//   node capabilityproof/cli.mjs receipt <receipt_id>
//   node capabilityproof/cli.mjs explain <capability_id>

import { createService } from './lib/service.mjs';

const [command, ...rest] = process.argv.slice(2);
const service = createService();

function print(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

const STATUS_ICON = { verified: 'PASS', failed_checks: 'FAIL', unreachable: 'DOWN', error: 'ERR ' };

async function main() {
  switch (command) {
    case 'list': {
      for (const c of service.listCapabilities()) {
        const v = c.latest_receipt ? `${c.latest_receipt.status}${c.latest_receipt.fresh ? '' : ' (stale)'}` : 'never verified';
        console.log(`${c.capability_id.padEnd(42)} ${c.category.padEnd(14)} ${v}`);
      }
      break;
    }
    case 'verify': {
      if (!rest[0]) throw new Error('usage: verify <capability_id>');
      const { receipt } = await service.verify(rest[0]);
      print(receipt);
      break;
    }
    case 'verify-all': {
      const results = await service.verifyAll();
      for (const r of results) {
        console.log(`[${STATUS_ICON[r.status] || r.status}] ${r.capability_id.padEnd(42)} ${r.latency_ms != null ? r.latency_ms + 'ms' : ''}`);
        for (const f of r.failures || []) console.log(`       - ${f}`);
        if (r.error) console.log(`       - ${r.error}`);
      }
      const verified = results.filter((r) => r.status === 'verified').length;
      console.log(`\n${verified}/${results.length} capabilities verified`);
      process.exitCode = verified === results.length ? 0 : 1;
      break;
    }
    case 'search': {
      if (!rest[0]) throw new Error('usage: search "<task>"');
      print(service.search({ task: rest.join(' ') }));
      break;
    }
    case 'route': {
      if (!rest[0]) throw new Error('usage: route "<task>"');
      print(await service.route({ task: rest.join(' ') }));
      break;
    }
    case 'receipt': {
      if (!rest[0]) throw new Error('usage: receipt <receipt_id>');
      print(service.getReceipt(rest[0]));
      break;
    }
    case 'explain': {
      if (!rest[0]) throw new Error('usage: explain <capability_id>');
      print(service.explainFailure(rest[0]));
      break;
    }
    default:
      console.error('Commands: list | verify <id> | verify-all | search "<task>" | route "<task>" | receipt <id> | explain <id>');
      process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});
