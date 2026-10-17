// Adapter 6 — NASA ASRS (Aviation Safety Reporting System).
//
// ASRS exports to CSV in controlled windows (max 10,000 records per download,
// monthly updates) with no open bulk API, so this adapter is offline/
// structured-first: load ASRS CSV exports (the asrs.csv schema). Column names
// vary across the ASRS export tool's revisions, so mapping is flexible.
//
// ASRS reports are voluntary, self-reported, and NOT independently verified.
// This adapter therefore only ever feeds the human-factors THEME layer, which
// is the lowest-weighted signal and always caveated downstream. It is never
// used as hard evidence.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '../../csv.js';
import { STATUS, healthRecord, statusForFetchError } from '../health.js';
import { normalizeRowKeys, buildColumnMapping, applyMapping } from '../columnMap.js';

const SOURCE = 'asrs';

// Datastore-compatible view (must match datastore.asrsForContext usage).
export const ASRS_COLUMNS = ['ACN', 'DATE', 'MFR', 'MODEL', 'AIRPORT', 'THEMES', 'SYNOPSIS'];
export const ASRS_THEME_COLUMNS = ['THEME', 'REPORT_COUNT'];

const FIELD_CANDIDATES = {
  ACN: ['ACN', 'ACCESSION_NUMBER', 'REPORT_NUMBER', 'ACN_NUMBER'],
  DATE: ['DATE', 'TIME_DATE', 'REPORT_DATE', 'EVENT_DATE'],
  MFR: ['MFR', 'MAKE', 'AIRCRAFT_MAKE', 'ACFT_MAKE', 'AIRCRAFT_MAKE_MODEL'],
  MODEL: ['MODEL', 'AIRCRAFT_MODEL', 'ACFT_MODEL'],
  AIRPORT: ['AIRPORT', 'LOCALE_REFERENCE', 'AIRPORT_CODE', 'LOCATION'],
  THEMES: ['THEMES', 'HUMAN_FACTORS', 'CONTRIBUTING_FACTORS', 'ANOMALY', 'FACTORS'],
  SYNOPSIS: ['SYNOPSIS', 'NARRATIVE', 'REPORT_NARRATIVE', 'SUMMARY'],
};
const ESSENTIAL = ['ACN'];

// ASRS human-factors fields are often semicolon-, comma-, or slash-delimited.
export function splitThemes(raw) {
  return (raw ?? '')
    .split(/[;,/|]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function normalizeAsrsRows(rawRows) {
  if (rawRows.length === 0) return { rows: [], missing: [] };
  const headers = Object.keys(normalizeRowKeys(rawRows[0]));
  const { mapping, missing } = buildColumnMapping(headers, FIELD_CANDIDATES);
  if (ESSENTIAL.some((f) => missing.includes(f))) return { rows: [], missing };
  const rows = rawRows.map((raw) => {
    const r = applyMapping(normalizeRowKeys(raw), mapping);
    // Re-join themes on ';' so the report pipeline's splitter reads them.
    r.THEMES = splitThemes(r.THEMES).join(';');
    return {
      ACN: r.ACN ?? '',
      DATE: (r.DATE ?? '').slice(0, 10),
      MFR: r.MFR ?? '',
      MODEL: r.MODEL ?? '',
      AIRPORT: r.AIRPORT ?? '',
      THEMES: r.THEMES,
      SYNOPSIS: r.SYNOPSIS ?? '',
    };
  });
  return { rows, missing: [] };
}

function themeSummary(rows) {
  const counts = new Map();
  for (const r of rows) {
    for (const theme of splitThemes(r.THEMES)) {
      counts.set(theme, (counts.get(theme) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([THEME, REPORT_COUNT]) => ({ THEME, REPORT_COUNT }));
}

export const asrsAdapter = {
  name: SOURCE,

  async run(ctx) {
    const startedAt = new Date();

    try {
      if (!ctx.options.offline) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.SOURCE_UNAVAILABLE,
          error_message:
            'ASRS has no open bulk API (exports are limited to 10,000-record windows); export CSVs and load with --offline <dir>',
          confidence: 'none',
        });
      }

      const dir = ctx.options.offline;
      const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csv'));
      const rawRows = [];
      for (const f of files) {
        const buffer = readFileSync(join(dir, f));
        ctx.artifactStore.save(SOURCE, f, buffer, { sourceUrl: `offline:${join(dir, f)}` });
        rawRows.push(...parseCsv(buffer.toString('utf8')));
      }

      const { rows, missing } = normalizeAsrsRows(rawRows);
      if (missing.length > 0) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.VALIDATION_FAILED,
          error_message: `unmapped essential columns: ${missing.join(', ')} — extend FIELD_CANDIDATES`,
          confidence: 'none',
        });
      }
      if (rows.length === 0) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.ZERO_ROWS,
          error_message: `no ASRS rows in ${files.length} file(s) from ${dir}`,
          confidence: 'none',
        });
      }

      const staged = [
        ctx.tableStore.writeStaging(SOURCE, 'asrs_reports', ASRS_COLUMNS, rows),
        ctx.tableStore.writeStaging(SOURCE, 'asrs', ASRS_COLUMNS, rows),
        ctx.tableStore.writeStaging(SOURCE, 'asrs_human_factor_themes', ASRS_THEME_COLUMNS, themeSummary(rows)),
      ];

      const schemaChanges = ctx.tableStore.detectSchemaChanges(SOURCE, staged);
      if (schemaChanges.length > 0 && !ctx.options.acceptSchemaChange) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.SCHEMA_CHANGED,
          records_loaded: 0,
          error_message: `schema changed for: ${schemaChanges.map((c) => c.table).join(', ')} — staging NOT promoted`,
          confidence: 'low',
        });
      }

      ctx.tableStore.promote(SOURCE);
      ctx.tableStore.saveSchemaFingerprints(SOURCE, staged);

      return healthRecord(SOURCE, startedAt, {
        status: STATUS.OK_WITH_WARNINGS,
        records_discovered: rows.length,
        records_loaded: rows.length,
        schema_version: 'asrs-v1',
        error_message:
          `offline mode: loaded ${rows.length} ASRS narrative(s). ` +
          'Voluntary, self-reported, unverified — human-factors themes only, never hard evidence.',
        // Deliberately capped: ASRS is the lowest-confidence source by design.
        confidence: 'low',
      });
    } catch (err) {
      return healthRecord(SOURCE, startedAt, {
        status: statusForFetchError(err),
        error_message: String(err.message ?? err),
        confidence: 'none',
      });
    }
  },
};
