// Adapter 8 — FAA Wildlife Strike Database.
//
// Airport/model environmental exposure (not accusation). Offline/structured-
// first: load a wildlife-strike event export. Aggregates 5-year strike counts
// per airport and merges the count into the shared airport_risk view, and
// summarises species and damaging strikes for context.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '../../csv.js';
import { STATUS, healthRecord, statusForFetchError } from '../health.js';
import { normalizeRowKeys, buildColumnMapping, applyMapping } from '../columnMap.js';
import { countByAirportWithin, mergeAirportColumn, AIRPORT_RISK_COLUMNS } from '../airportRisk.js';

const SOURCE = 'wildlife_strikes';

export const WILDLIFE_STRIKE_COLUMNS = ['AIRPORT', 'DATE', 'SPECIES', 'DAMAGE'];
export const WILDLIFE_RISK_COLUMNS = ['AIRPORT', 'STRIKES_5YR', 'DAMAGING_STRIKES_5YR'];
export const SPECIES_RISK_COLUMNS = ['SPECIES', 'STRIKE_COUNT'];

const FIELD_CANDIDATES = {
  AIRPORT: ['AIRPORT', 'AIRPORT_ID', 'AIRPORT_CODE', 'LOCATION_ID', 'FAAID'],
  DATE: ['DATE', 'INCIDENT_DATE', 'EVENT_DATE', 'STRIKE_DATE'],
  SPECIES: ['SPECIES', 'SPECIES_NAME', 'SPECIES_ID'],
  DAMAGE: ['DAMAGE', 'INDICATED_DAMAGE', 'DAMAGE_LEVEL', 'AIRCRAFT_DAMAGE'],
};
const ESSENTIAL = ['AIRPORT'];

// A strike is "damaging" unless the damage field clearly says none/no.
export function isDamaging(damage) {
  const d = (damage ?? '').trim().toLowerCase();
  if (!d) return false;
  return !/^(n|no|none|no damage|0)$/.test(d);
}

export function normalizeStrikes(rawRows) {
  if (rawRows.length === 0) return { rows: [], missing: [] };
  const headers = Object.keys(normalizeRowKeys(rawRows[0]));
  const { mapping, missing } = buildColumnMapping(headers, FIELD_CANDIDATES);
  if (ESSENTIAL.some((f) => missing.includes(f))) return { rows: [], missing };
  const rows = rawRows.map((raw) => {
    const r = applyMapping(normalizeRowKeys(raw), mapping);
    return {
      AIRPORT: (r.AIRPORT ?? '').toUpperCase(),
      DATE: (r.DATE ?? '').slice(0, 10),
      SPECIES: r.SPECIES ?? '',
      DAMAGE: r.DAMAGE ?? '',
    };
  });
  return { rows, missing: [] };
}

export const wildlifeStrikesAdapter = {
  name: SOURCE,

  async run(ctx) {
    const startedAt = new Date();
    try {
      if (!ctx.options.offline) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.SOURCE_UNAVAILABLE,
          error_message:
            'FAA Wildlife Strike Database has no clean bulk API; export a strike CSV and load with --offline <dir>',
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

      const { rows: strikes, missing } = normalizeStrikes(rawRows);
      if (missing.length > 0) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.VALIDATION_FAILED,
          error_message: `unmapped essential columns: ${missing.join(', ')} — extend FIELD_CANDIDATES`,
          confidence: 'none',
        });
      }
      if (strikes.length === 0) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.ZERO_ROWS,
          error_message: `no wildlife-strike rows in ${files.length} file(s) from ${dir}`,
          confidence: 'none',
        });
      }

      const counts = countByAirportWithin(strikes, {
        airportKey: 'AIRPORT', dateKey: 'DATE', years: 5, now: ctx.now,
      });
      const damaging = countByAirportWithin(strikes.filter((s) => isDamaging(s.DAMAGE)), {
        airportKey: 'AIRPORT', dateKey: 'DATE', years: 5, now: ctx.now,
      });
      const wildlifeRisk = [...counts.entries()].map(([AIRPORT, n]) => ({
        AIRPORT, STRIKES_5YR: String(n), DAMAGING_STRIKES_5YR: String(damaging.get(AIRPORT) ?? 0),
      }));

      const speciesCounts = new Map();
      for (const s of strikes) {
        if (!s.SPECIES) continue;
        speciesCounts.set(s.SPECIES, (speciesCounts.get(s.SPECIES) ?? 0) + 1);
      }
      const speciesRisk = [...speciesCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([SPECIES, STRIKE_COUNT]) => ({ SPECIES, STRIKE_COUNT: String(STRIKE_COUNT) }));

      const merged = mergeAirportColumn(
        ctx.tableStore.readProduction('airport_risk'), counts, 'WILDLIFE_STRIKES_5YR',
      );

      const staged = [
        ctx.tableStore.writeStaging(SOURCE, 'wildlife_strikes', WILDLIFE_STRIKE_COLUMNS, strikes),
        ctx.tableStore.writeStaging(SOURCE, 'airport_wildlife_risk', WILDLIFE_RISK_COLUMNS, wildlifeRisk),
        ctx.tableStore.writeStaging(SOURCE, 'species_risk', SPECIES_RISK_COLUMNS, speciesRisk),
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
        records_discovered: strikes.length,
        records_loaded: strikes.length,
        schema_version: 'wildlife-strikes-v1',
        error_message: `offline mode: ${strikes.length} strike(s) across ${counts.size} airport(s). Airport/model exposure, not accusation.`,
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
