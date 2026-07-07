// Adapter 1 — FAA aircraft registry (Releasable Aircraft database).
//
// discover → download → hash/store raw → extract → transform full bundle →
// validate → load staging → promote. The download link is discovered from
// the official FAA page rather than hardcoded; the canonical URL is only a
// documented fallback when page discovery fails.

import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { httpGetBuffer, httpGetText, extractLinks } from '../http.js';
import { STATUS, healthRecord, statusForFetchError } from '../health.js';
import {
  transformRegistryBundle,
  BUNDLE_FILES,
  REGISTRY_COLUMNS,
} from '../../sources/transformFaaRegistry.js';

export const DISCOVERY_PAGE =
  'https://www.faa.gov/licenses_certificates/aircraft_certification/aircraft_registry/releasable_aircraft_download';
export const CANONICAL_ZIP_URL = 'https://registry.faa.gov/database/ReleasableAircraft.zip';

const SOURCE = 'faa_registry';
// Live FAA registry has ~290k aircraft; far fewer rows means a partial file.
const LOW_ROW_WARNING_THRESHOLD = 1000;

export const faaRegistryAdapter = {
  name: SOURCE,

  async run(ctx) {
    const startedAt = new Date();
    const warnings = [];
    let artifactHash = '';
    let downloaded = 0;

    try {
      let bundleDir;

      if (ctx.options.offline) {
        // Offline mode: a directory of pre-extracted bundle files.
        bundleDir = ctx.options.offline;
        warnings.push(`offline mode: reading extracted bundle from ${bundleDir}`);
      } else {
        const { url, discoveryWarning } = await discoverZipUrl(ctx);
        if (discoveryWarning) warnings.push(discoveryWarning);

        const { buffer, status } = await httpGetBuffer(ctx.fetchImpl, url);
        downloaded = 1;
        const saved = ctx.artifactStore.save(SOURCE, 'ReleasableAircraft.zip', buffer, {
          sourceUrl: url,
          httpStatus: status,
          discoveredAt: new Date().toISOString(),
        });
        artifactHash = saved.hash;
        if (saved.duplicate) {
          warnings.push('zip content unchanged since last run (same sha256) — re-transforming from stored artifact');
        }
        bundleDir = `${saved.path}.extracted`;
        mkdirSync(bundleDir, { recursive: true });
        execFileSync('unzip', ['-o', '-q', saved.path, '-d', bundleDir]);
      }

      const files = readBundle(bundleDir);
      if (!files.master || !files.acftref || !files.engine) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.VALIDATION_FAILED,
          records_downloaded: downloaded,
          artifact_hash: artifactHash,
          error_message: `bundle missing required files in ${bundleDir} (need MASTER.txt, ACFTREF.txt, ENGINE.txt)`,
          confidence: 'none',
        });
      }

      const { tables, warnings: tw } = transformRegistryBundle(files);
      warnings.push(...tw);

      // Validation: required columns and non-zero rows on the spine table.
      const registryTable = tables.find((t) => t.name === 'aircraft_registry_current');
      if (registryTable.rows.length === 0) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.ZERO_ROWS,
          records_downloaded: downloaded,
          artifact_hash: artifactHash,
          error_message: 'aircraft_registry_current transformed to zero rows',
          confidence: 'none',
        });
      }
      const missingCols = REGISTRY_COLUMNS.filter((c) => !registryTable.columns.includes(c));
      if (missingCols.length > 0) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.VALIDATION_FAILED,
          records_downloaded: downloaded,
          artifact_hash: artifactHash,
          error_message: `registry table missing required columns: ${missingCols.join(', ')}`,
          confidence: 'none',
        });
      }
      if (registryTable.rows.length < LOW_ROW_WARNING_THRESHOLD) {
        warnings.push(
          `registry row count ${registryTable.rows.length} is far below the live dataset (~290k) — fixture or partial download?`,
        );
      }

      const staged = tables.map((t) =>
        ctx.tableStore.writeStaging(SOURCE, t.name, t.columns, t.rows),
      );

      const schemaChanges = ctx.tableStore.detectSchemaChanges(SOURCE, staged);
      if (schemaChanges.length > 0 && !ctx.options.acceptSchemaChange) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.SCHEMA_CHANGED,
          records_downloaded: downloaded,
          records_loaded: 0,
          artifact_hash: artifactHash,
          error_message: `schema changed for: ${schemaChanges.map((c) => c.table).join(', ')} — staging NOT promoted; rerun with --accept-schema-change after review`,
          confidence: 'low',
        });
      }

      ctx.tableStore.promote(SOURCE);
      ctx.tableStore.saveSchemaFingerprints(SOURCE, staged);

      const totalRows = staged.reduce((s, t) => s + t.rows, 0);
      return healthRecord(SOURCE, startedAt, {
        status: warnings.length > 0 ? STATUS.OK_WITH_WARNINGS : STATUS.OK,
        records_discovered: staged.length,
        records_downloaded: downloaded,
        records_loaded: totalRows,
        artifact_hash: artifactHash,
        schema_version: 'faa-ardata-v1',
        error_message: warnings.join(' | '),
        confidence: registryTable.rows.length >= LOW_ROW_WARNING_THRESHOLD ? 'high' : 'medium',
      });
    } catch (err) {
      return healthRecord(SOURCE, startedAt, {
        status: statusForFetchError(err),
        records_downloaded: downloaded,
        artifact_hash: artifactHash,
        error_message: String(err.message ?? err),
        confidence: 'none',
      });
    }
  },
};

async function discoverZipUrl(ctx) {
  try {
    const { text } = await httpGetText(ctx.fetchImpl, ctx.options.discoveryPage ?? DISCOVERY_PAGE);
    const link = extractLinks(text, DISCOVERY_PAGE).find((href) =>
      /ReleasableAircraft.*\.zip$/i.test(href),
    );
    if (link) return { url: link };
    return {
      url: CANONICAL_ZIP_URL,
      discoveryWarning: 'no ReleasableAircraft zip link found on FAA page — using canonical fallback URL',
    };
  } catch (err) {
    return {
      url: CANONICAL_ZIP_URL,
      discoveryWarning: `discovery page unreachable (${err.message}) — using canonical fallback URL`,
    };
  }
}

function readBundle(dir) {
  const files = {};
  for (const entry of readdirSync(dir)) {
    for (const [key, re] of Object.entries(BUNDLE_FILES)) {
      if (re.test(entry)) {
        files[key] = readFileSync(join(dir, entry), 'latin1');
      }
    }
  }
  return files;
}
