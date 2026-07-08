// Ingestion runner: executes adapters in dependency order with hard
// isolation — a blocked or crashing source must never stop other adapters.
// Every run (success or failure) lands in the health log and the daily
// ingestion-health report.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ArtifactStore } from './artifactStore.js';
import { TableStore } from './tableStore.js';
import { HealthLog, healthRecord, STATUS } from './health.js';
import { faaRegistryAdapter } from './adapters/faaRegistry.js';
import { faaSdrAdapter } from './adapters/faaSdr.js';
import { ntsbAdapter } from './adapters/ntsb.js';
import { faaAdAdapter } from './adapters/faaAd.js';

// Registry first: SDR/NTSB/AD match and applicability layers read the
// promoted registry table.
export const ADAPTERS = new Map([
  ['faa-registry', faaRegistryAdapter],
  ['faa-sdr', faaSdrAdapter],
  ['ntsb', ntsbAdapter],
  ['faa-ad', faaAdAdapter],
]);

export function buildContext(base, { now = new Date(), fetchImpl = globalThis.fetch, options = {} } = {}) {
  return {
    base,
    now,
    fetchImpl,
    options,
    artifactStore: new ArtifactStore(base, { now }),
    tableStore: new TableStore(base),
  };
}

export async function runIngestion(names, ctx) {
  const selected = names.includes('all') ? [...ADAPTERS.keys()] : names;
  const healthLog = new HealthLog(ctx.base, { now: ctx.now });
  const records = [];

  for (const name of selected) {
    const adapter = ADAPTERS.get(name);
    if (!adapter) {
      records.push(
        healthRecord(name, new Date(), {
          status: STATUS.SOURCE_UNAVAILABLE,
          error_message: `unknown source "${name}" — known: ${[...ADAPTERS.keys()].join(', ')}`,
          confidence: 'none',
        }),
      );
      continue;
    }
    // `ingest all --offline <dir>` expects one subdirectory per source
    // (faa_registry/, faa_sdr/, ntsb/); a single-source run takes the
    // directory as-is.
    let adapterCtx = ctx;
    if (ctx.options.offline && selected.length > 1) {
      const subdir = join(ctx.options.offline, adapter.name);
      adapterCtx = {
        ...ctx,
        options: { ...ctx.options, offline: existsSync(subdir) ? subdir : undefined },
      };
    }
    let record;
    try {
      record = await adapter.run(adapterCtx);
    } catch (err) {
      // Adapters catch their own errors; this is the belt-and-braces layer.
      record = healthRecord(adapter.name, new Date(), {
        status: STATUS.SOURCE_UNAVAILABLE,
        error_message: `adapter crashed: ${String(err.message ?? err)}`,
        confidence: 'none',
      });
    }
    records.push(record);
    healthLog.append(record);
  }

  const reportPath = healthLog.writeDailyReport(records);
  return { records, reportPath };
}
