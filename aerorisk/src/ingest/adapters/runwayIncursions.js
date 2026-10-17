// Adapter 7 — FAA ASIAS runway incursion data.
//
// Airport surface-risk context (not aircraft- or operator-specific blame).
// Offline/structured-first: load an ASIAS runway-incursion event export.
// Aggregates 5-year incursion counts per airport and merges the count into
// the shared airport_risk view read by the airport context module.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '../../csv.js';
import { STATUS, healthRecord, statusForFetchError } from '../health.js';
import { normalizeRowKeys, buildColumnMapping, applyMapping } from '../columnMap.js';
import { countByAirportWithin, mergeAirportColumn, AIRPORT_RISK_COLUMNS } from '../airportRisk.js';

const SOURCE = 'runway_incursions';

export const RUNWAY_INCURSION_COLUMNS = ['AIRPORT', 'DATE', 'SEVERITY', 'DESCRIPTION'];
export const SURFACE_RISK_COLUMNS = ['AIRPORT', 'INCURSIONS_5YR'];

const FIELD_CANDIDATES = {
  AIRPORT: ['AIRPORT', 'AIRPORT_ID', 'AIRPORT_CODE', 'LOCATION_ID', 'FACILITY', 'LOCID'],
  DATE: ['DATE', 'EVENT_DATE', 'INCIDENT_DATE', 'LOCAL_DATE', 'OCCURRENCE_DATE'],
  SEVERITY: ['SEVERITY', 'CATEGORY', 'RI_CATEGORY', 'CLASSIFICATION'],
  DESCRIPTION: ['DESCRIPTION', 'NARRATIVE', 'REMARKS', 'SUMMARY'],
};
const ESSENTIAL = ['AIRPORT'];

export function normalizeIncursions(rawRows) {
  if (rawRows.length === 0) return { rows: [], missing: [] };
  const headers = Object.keys(normalizeRowKeys(rawRows[0]));
  const { mapping, missing } = buildColumnMapping(headers, FIELD_CANDIDATES);
  if (ESSENTIAL.some((f) => missing.includes(f))) return { rows: [], missing };
  const rows = rawRows.map((raw) => {
    const r = applyMapping(normalizeRowKeys(raw), mapping);
    return {
      AIRPORT: (r.AIRPORT ?? '').toUpperCase(),
      DATE: (r.DATE ?? '').slice(0, 10),
      SEVERITY: r.SEVERITY ?? '',
      DESCRIPTION: r.DESCRIPTION ?? '',
    };
  });
  return { rows, missing: [] };
}

export const runwayIncursionsAdapter = {
  name: SOURCE,

  async run(ctx) {
    const startedAt = new Date();
    try {
      if (!ctx.options.offline) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.SOURCE_UNAVAILABLE,
          error_message:
            'ASIAS runway-incursion data has no clean bulk API; export an event CSV and load with --offline <dir>',
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

      const { rows: events, missing } = normalizeIncursions(rawRows);
      if (missing.length > 0) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.VALIDATION_FAILED,
          error_message: `unmapped essential columns: ${missing.join(', ')} — extend FIELD_CANDIDATES`,
          confidence: 'none',
        });
      }
      if (events.length === 0) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.ZERO_ROWS,
          error_message: `no runway-incursion rows in ${files.length} file(s) from ${dir}`,
          confidence: 'none',
        });
      }

      const counts = countByAirportWithin(events, {
        airportKey: 'AIRPORT', dateKey: 'DATE', years: 5, now: ctx.now,
      });
      const surfaceRisk = [...counts.entries()].map(([AIRPORT, n]) => ({ AIRPORT, INCURSIONS_5YR: String(n) }));
      const merged = mergeAirportColumn(
        ctx.tableStore.readProduction('airport_risk'), counts, 'RUNWAY_INCURSIONS_5YR',
      );

      const staged = [
        ctx.tableStore.writeStaging(SOURCE, 'runway_incursions', RUNWAY_INCURSION_COLUMNS, events),
        ctx.tableStore.writeStaging(SOURCE, 'airport_surface_risk', SURFACE_RISK_COLUMNS, surfaceRisk),
        ctx.tableStore.writeStaging(SOURCE, 'airport_risk', AIRPORT_RISK_COLUMNS, merged),
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
        records_discovered: events.length,
        records_loaded: events.length,
        schema_version: 'runway-incursions-v1',
        error_message: `offline mode: ${events.length} incursion event(s) across ${counts.size} airport(s). Airport context, not aircraft/operator blame.`,
        confidence: 'medium',
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
