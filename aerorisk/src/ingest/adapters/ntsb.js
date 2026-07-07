// Adapter 3 — NTSB accidents/incidents.
//
// Two modes per the ingestion spec:
//   api  — targeted queries against the NTSB public developer API
//          (data.ntsb.gov) for a list of registration numbers
//   bulk — the downloadable aviation accident datasets (1962–1981 and
//          1982–present), or any CAROL JSON/CSV export
// Offline mode ingests local .json/.csv exports with the same transforms.
//
// The NTSB API's exact response shape has NOT been verified from this
// sandbox (network-blocked); field extraction is therefore defensive
// (candidate paths per field) and unmapped shapes surface as warnings, not
// silent empties.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '../../csv.js';
import { httpGetBuffer } from '../http.js';
import { STATUS, healthRecord, statusForFetchError } from '../health.js';
import { normalizeRowKeys, buildColumnMapping, applyMapping } from '../columnMap.js';
import { normalizeNNumber } from '../../identity.js';

const SOURCE = 'ntsb';
export const NTSB_API_ROOT = 'https://data.ntsb.gov/carol-main-public/api/Query/Main';
export const NTSB_BULK_PAGE = 'https://data.ntsb.gov/avdata';

export const NTSB_COLUMNS = [
  'EVENT_ID', 'DATE', 'N_NUMBER', 'SERIAL_NUMBER', 'MFR', 'MODEL',
  'OPERATOR', 'CITY', 'STATE', 'AIRPORT', 'HIGHEST_INJURY', 'DAMAGE',
  'STATUS', 'PROBABLE_CAUSE', 'SOURCE_MODE',
];

// CSV bulk-export header candidates (normalised).
const CSV_CANDIDATES = {
  EVENT_ID: ['EVENT_ID', 'NTSB_NO', 'NTSBNO', 'NTSB_NUMBER', 'EV_ID', 'MKEY'],
  DATE: ['DATE', 'EVENT_DATE', 'EV_DATE'],
  N_NUMBER: ['N_NUMBER', 'REGISTRATION_NUMBER', 'REGIST_NO', 'REGISTRATION'],
  SERIAL_NUMBER: ['SERIAL_NUMBER', 'ACFT_SERIAL_NO'],
  MFR: ['MFR', 'MAKE', 'ACFT_MAKE', 'AIRCRAFT_MAKE'],
  MODEL: ['MODEL', 'ACFT_MODEL', 'AIRCRAFT_MODEL'],
  OPERATOR: ['OPERATOR', 'OPERATOR_NAME', 'OPER_NAME'],
  CITY: ['CITY', 'EV_CITY', 'LOCATION_CITY'],
  STATE: ['STATE', 'EV_STATE', 'LOCATION_STATE'],
  AIRPORT: ['AIRPORT', 'AIRPORT_CODE', 'EV_AIRPORT', 'AIRPORT_ID'],
  HIGHEST_INJURY: ['HIGHEST_INJURY', 'EV_HIGHEST_INJURY', 'HIGHEST_INJURY_LEVEL', 'INJURY_SEVERITY'],
  DAMAGE: ['DAMAGE', 'DAMAGE_LEVEL', 'ACFT_DAMAGE', 'AIRCRAFT_DAMAGE'],
  STATUS: ['STATUS', 'REPORT_STATUS', 'COMPLETION_STATUS'],
  PROBABLE_CAUSE: ['PROBABLE_CAUSE', 'CM_PROBABLECAUSE', 'PROBABLE_CAUSE_TEXT', 'CAUSE'],
};

// JSON candidate paths per field (dot paths; first hit wins).
const JSON_CANDIDATES = {
  EVENT_ID: ['cm_ntsbNum', 'ntsbNumber', 'NtsbNumber', 'cm_mkey', 'ev_id'],
  DATE: ['cm_eventDate', 'eventDate', 'EventDate', 'ev_date'],
  N_NUMBER: ['cm_vehicles.0.registrationNumber', 'vehicles.0.registrationNumber', 'RegistrationNumber', 'registration'],
  SERIAL_NUMBER: ['cm_vehicles.0.serialNumber', 'vehicles.0.serialNumber', 'SerialNumber'],
  MFR: ['cm_vehicles.0.make', 'vehicles.0.make', 'Make'],
  MODEL: ['cm_vehicles.0.model', 'vehicles.0.model', 'Model'],
  OPERATOR: ['cm_vehicles.0.operatorName', 'vehicles.0.operatorName', 'OperatorName', 'operator'],
  CITY: ['cm_city', 'city', 'City'],
  STATE: ['cm_state', 'state', 'State'],
  AIRPORT: ['cm_airportId', 'airportId', 'AirportID'],
  HIGHEST_INJURY: ['cm_highestInjury', 'highestInjury', 'HighestInjuryLevel'],
  DAMAGE: ['cm_vehicles.0.damageLevel', 'vehicles.0.damageLevel', 'DamageLevel', 'damage'],
  STATUS: ['cm_completionStatus', 'completionStatus', 'Status'],
  PROBABLE_CAUSE: ['cm_probableCause', 'probableCause', 'ProbableCause'],
};

function pick(obj, paths) {
  for (const path of paths) {
    let cur = obj;
    for (const part of path.split('.')) {
      if (cur == null) break;
      cur = cur[part];
    }
    if (cur !== undefined && cur !== null && cur !== '') return String(cur);
  }
  return '';
}

export function transformNtsbJson(jsonText, mode = 'api') {
  const parsed = JSON.parse(jsonText);
  const items = Array.isArray(parsed) ? parsed : parsed.results ?? parsed.Results ?? parsed.cases ?? [];
  const events = [];
  for (const item of items) {
    const ev = {};
    for (const [field, paths] of Object.entries(JSON_CANDIDATES)) {
      ev[field] = pick(item, paths);
    }
    if (!ev.EVENT_ID && !ev.DATE) continue;
    ev.N_NUMBER = ev.N_NUMBER ? normalizeNNumber(ev.N_NUMBER) : '';
    ev.DATE = ev.DATE.slice(0, 10);
    ev.SOURCE_MODE = mode;
    events.push(ev);
  }
  return events;
}

export function transformNtsbCsv(csvText, mode = 'bulk') {
  const rawRows = parseCsv(csvText);
  if (rawRows.length === 0) return { events: [], missing: [] };
  const headers = Object.keys(normalizeRowKeys(rawRows[0]));
  const { mapping, missing } = buildColumnMapping(headers, CSV_CANDIDATES);
  const events = rawRows.map((raw) => {
    const ev = applyMapping(normalizeRowKeys(raw), mapping);
    ev.N_NUMBER = ev.N_NUMBER ? normalizeNNumber(ev.N_NUMBER) : '';
    ev.SOURCE_MODE = mode;
    return ev;
  });
  return { events, missing };
}

export const ntsbAdapter = {
  name: SOURCE,

  async run(ctx) {
    const startedAt = new Date();
    const warnings = [];
    let downloaded = 0;

    try {
      if (ctx.options.offline) {
        const dir = ctx.options.offline;
        for (const f of readdirSync(dir)) {
          if (!/\.(json|csv)$/i.test(f)) continue;
          ctx.artifactStore.save(SOURCE, f, readFileSync(join(dir, f)), {
            sourceUrl: `offline:${join(dir, f)}`,
          });
        }
        warnings.push(`offline mode: loaded exports from ${dir}`);
      } else if ((ctx.options.mode ?? 'api') === 'api') {
        const tails = resolveTails(ctx);
        if (tails.length === 0) {
          return healthRecord(SOURCE, startedAt, {
            status: STATUS.PARTIAL,
            error_message: 'api mode: no tails to query (pass --tails or ingest faa-registry first)',
            confidence: 'none',
          });
        }
        const queryUrl = ctx.options.ntsbApi ?? NTSB_API_ROOT;
        for (const tail of tails) {
          // Registration-number query; response stored raw before transform.
          const url = `${queryUrl}?RegistrationNumber=${encodeURIComponent(tail)}`;
          const { buffer } = await httpGetBuffer(ctx.fetchImpl, url);
          ctx.artifactStore.save(SOURCE, `api_${tail}.json`, buffer, { sourceUrl: url });
          downloaded += 1;
        }
      } else {
        const url = ctx.options.bulkUrl;
        if (!url) {
          return healthRecord(SOURCE, startedAt, {
            status: STATUS.SOURCE_UNAVAILABLE,
            error_message: `bulk mode requires --bulk-url (dataset links live on ${NTSB_BULK_PAGE}; exact file URLs vary)`,
            confidence: 'none',
          });
        }
        const { buffer } = await httpGetBuffer(ctx.fetchImpl, url);
        ctx.artifactStore.save(SOURCE, url.split('/').at(-1) || 'ntsb_bulk.csv', buffer, { sourceUrl: url });
        downloaded = 1;
      }

      // Transform all stored artifacts.
      const events = [];
      for (const artifact of ctx.artifactStore.list(SOURCE)) {
        const text = readFileSync(artifact.path, 'utf8');
        if (artifact.name.endsWith('.json')) {
          try {
            events.push(...transformNtsbJson(text, artifact.name.startsWith('api_') ? 'api' : 'bulk'));
          } catch (err) {
            warnings.push(`${artifact.name}: JSON parse failed (${err.message})`);
          }
        } else if (artifact.name.endsWith('.csv')) {
          const { events: evs, missing } = transformNtsbCsv(text);
          if (missing.includes('EVENT_ID') || missing.includes('DATE')) {
            warnings.push(`${artifact.name}: unmapped essential columns ${missing.join(', ')} — file skipped, extend CSV_CANDIDATES`);
            continue;
          }
          events.push(...evs);
        }
      }

      // Deduplicate by EVENT_ID (API + bulk can overlap).
      const byId = new Map();
      for (const ev of events) byId.set(ev.EVENT_ID || `${ev.DATE}|${ev.N_NUMBER}`, ev);
      const unique = [...byId.values()];

      if (unique.length === 0) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.ZERO_ROWS,
          records_downloaded: downloaded,
          error_message: `no NTSB events transformed${warnings.length ? `: ${warnings.join(' | ')}` : ''}`,
          confidence: 'none',
        });
      }

      const staged = [
        ctx.tableStore.writeStaging(SOURCE, 'ntsb_events', NTSB_COLUMNS, unique),
        // Datastore-compatible view.
        ctx.tableStore.writeStaging(SOURCE, 'ntsb', NTSB_COLUMNS, unique),
      ];

      // Registry match layer.
      const registry = ctx.tableStore.readProduction('aircraft_registry_current');
      if (registry) {
        const byN = new Map(registry.map((r) => [normalizeNNumber(r.N_NUMBER), r]));
        const bySerial = new Map(registry.filter((r) => r.SERIAL_NUMBER).map((r) => [r.SERIAL_NUMBER, r]));
        const matches = unique.map((ev) => {
          let confidence = 'NO_MATCH';
          let matched = '';
          if (ev.N_NUMBER && byN.has(ev.N_NUMBER)) {
            confidence = 'EXACT_N_NUMBER';
            matched = ev.N_NUMBER;
          } else if (ev.SERIAL_NUMBER && bySerial.has(ev.SERIAL_NUMBER)) {
            confidence = 'SERIAL_MATCH';
            matched = normalizeNNumber(bySerial.get(ev.SERIAL_NUMBER).N_NUMBER);
          } else if (ev.MFR && ev.MODEL) {
            confidence = 'MODEL_ONLY';
          }
          return { EVENT_ID: ev.EVENT_ID, EVENT_N_NUMBER: ev.N_NUMBER, MATCHED_N_NUMBER: matched, CONFIDENCE: confidence };
        });
        staged.push(
          ctx.tableStore.writeStaging(
            SOURCE, 'ntsb_registry_matches',
            ['EVENT_ID', 'EVENT_N_NUMBER', 'MATCHED_N_NUMBER', 'CONFIDENCE'], matches,
          ),
        );
      } else {
        warnings.push('registry production table not available — registry match layer skipped');
      }

      const schemaChanges = ctx.tableStore.detectSchemaChanges(SOURCE, staged);
      if (schemaChanges.length > 0 && !ctx.options.acceptSchemaChange) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.SCHEMA_CHANGED,
          records_downloaded: downloaded,
          records_loaded: 0,
          error_message: `schema changed for: ${schemaChanges.map((c) => c.table).join(', ')} — staging NOT promoted`,
          confidence: 'low',
        });
      }

      ctx.tableStore.promote(SOURCE);
      ctx.tableStore.saveSchemaFingerprints(SOURCE, staged);

      return healthRecord(SOURCE, startedAt, {
        status: warnings.length > 0 ? STATUS.OK_WITH_WARNINGS : STATUS.OK,
        records_discovered: unique.length,
        records_downloaded: downloaded,
        records_loaded: unique.length,
        schema_version: 'ntsb-v1',
        error_message: warnings.join(' | '),
        confidence: 'medium',
      });
    } catch (err) {
      return healthRecord(SOURCE, startedAt, {
        status: statusForFetchError(err),
        records_downloaded: downloaded,
        error_message: String(err.message ?? err),
        confidence: 'none',
      });
    }
  },
};

function resolveTails(ctx) {
  if (ctx.options.tails) {
    return String(ctx.options.tails)
      .split(',')
      .map((t) => normalizeNNumber(t.trim()))
      .filter(Boolean);
  }
  const registry = ctx.tableStore.readProduction('aircraft_registry_current');
  if (!registry) return [];
  const limit = Number(ctx.options.limit ?? 100);
  return registry.slice(0, limit).map((r) => normalizeNNumber(r.N_NUMBER));
}
