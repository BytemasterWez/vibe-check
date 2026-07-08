// Adapter 5 — FAA enforcement reports (quarterly compilations of closed
// actions: civil penalties, certificate suspensions/revocations).
//
// The quarterly compilations are published as documents without a clean bulk
// API, so this adapter is offline/structured-first: load a normalised
// enforcement CSV (the enforcement.csv schema) exported from the quarterly
// reports. It categorises each action (maintenance/operational/drug-testing/
// hazmat/certificate) and rolls entities up with counts.
//
// This is operator/company risk, not aircraft risk, and every finding is
// labelled "public enforcement history" downstream — never "bad operator".

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '../../csv.js';
import { STATUS, healthRecord, statusForFetchError } from '../health.js';
import { normalizeRowKeys, buildColumnMapping, applyMapping } from '../columnMap.js';
import { daysAgo } from '../../identity.js';

const SOURCE = 'faa_enforcement';

// Datastore-compatible view (must match datastore.enforcementForName usage).
export const ENFORCEMENT_COLUMNS = [
  'CASE_ID', 'DATE_CLOSED', 'RESPONDENT', 'RESPONDENT_TYPE', 'ACTION', 'AMOUNT', 'SUMMARY',
];
export const ENFORCEMENT_ACTION_COLUMNS = [
  ...ENFORCEMENT_COLUMNS, 'CATEGORY', 'RECENT',
];
export const ENFORCEMENT_ENTITY_COLUMNS = [
  'RESPONDENT', 'RESPONDENT_TYPE', 'ACTION_COUNT', 'CERTIFICATE_ACTIONS', 'CIVIL_PENALTY_COUNT',
];

const FIELD_CANDIDATES = {
  CASE_ID: ['CASE_ID', 'CASE_NUMBER', 'CASE_NO', 'EIR_NUMBER'],
  DATE_CLOSED: ['DATE_CLOSED', 'CLOSED_DATE', 'CLOSURE_DATE', 'DATE'],
  RESPONDENT: ['RESPONDENT', 'RESPONDENT_NAME', 'ENTITY', 'NAME'],
  RESPONDENT_TYPE: ['RESPONDENT_TYPE', 'ENTITY_TYPE', 'TYPE'],
  ACTION: ['ACTION', 'ACTION_TYPE', 'SANCTION', 'DISPOSITION'],
  AMOUNT: ['AMOUNT', 'CIVIL_PENALTY', 'PENALTY_AMOUNT', 'PENALTY'],
  SUMMARY: ['SUMMARY', 'DESCRIPTION', 'NARRATIVE', 'VIOLATION', 'REMARKS'],
};
const ESSENTIAL = ['RESPONDENT', 'ACTION'];

const CATEGORY_RULES = [
  [/maintenance|inspection|airworth|repair|return to service|record|logbook/i, 'maintenance'],
  [/drug|alcohol|testing/i, 'drug_testing'],
  [/hazmat|hazardous material|dangerous good/i, 'hazmat'],
  [/duty time|flight time|rest|fatigue|operational|part ?135|part ?121|dispatch/i, 'operational'],
];

export function categorize(summary, action) {
  for (const [re, cat] of CATEGORY_RULES) {
    if (re.test(summary ?? '')) return cat;
  }
  if (/revocation|suspension/i.test(action ?? '')) return 'certificate';
  return 'other';
}

export function normalizeEnforcementRows(rawRows, now = new Date()) {
  if (rawRows.length === 0) return { rows: [], missing: [] };
  const headers = Object.keys(normalizeRowKeys(rawRows[0]));
  const { mapping, missing } = buildColumnMapping(headers, FIELD_CANDIDATES);
  if (ESSENTIAL.some((f) => missing.includes(f))) return { rows: [], missing };
  const rows = rawRows.map((raw) => {
    const r = applyMapping(normalizeRowKeys(raw), mapping);
    const age = r.DATE_CLOSED ? daysAgo(r.DATE_CLOSED, now) : null;
    return {
      ...r,
      RESPONDENT_TYPE: r.RESPONDENT_TYPE ?? '',
      AMOUNT: r.AMOUNT ?? '',
      SUMMARY: r.SUMMARY ?? '',
      CATEGORY: categorize(r.SUMMARY, r.ACTION),
      RECENT: age !== null && age <= 5 * 365 ? 'yes' : 'no',
    };
  });
  return { rows, missing: [] };
}

function rollUpEntities(actions) {
  const byEntity = new Map();
  for (const a of actions) {
    if (!byEntity.has(a.RESPONDENT)) {
      byEntity.set(a.RESPONDENT, {
        RESPONDENT: a.RESPONDENT,
        RESPONDENT_TYPE: a.RESPONDENT_TYPE,
        ACTION_COUNT: 0,
        CERTIFICATE_ACTIONS: 0,
        CIVIL_PENALTY_COUNT: 0,
      });
    }
    const e = byEntity.get(a.RESPONDENT);
    e.ACTION_COUNT += 1;
    if (/revocation|suspension/i.test(a.ACTION)) e.CERTIFICATE_ACTIONS += 1;
    if (/civil_penalty|civil penalty|penalty/i.test(a.ACTION) || a.AMOUNT) e.CIVIL_PENALTY_COUNT += 1;
  }
  return [...byEntity.values()];
}

export const faaEnforcementAdapter = {
  name: SOURCE,

  async run(ctx) {
    const startedAt = new Date();
    const warnings = [];

    try {
      if (!ctx.options.offline) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.SOURCE_UNAVAILABLE,
          error_message:
            'FAA quarterly enforcement compilations have no clean bulk API; export them to the enforcement.csv schema and load with --offline <dir>',
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

      const { rows: actions, missing } = normalizeEnforcementRows(rawRows, ctx.now);
      if (missing.length > 0) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.VALIDATION_FAILED,
          error_message: `unmapped essential columns: ${missing.join(', ')} — extend FIELD_CANDIDATES`,
          confidence: 'none',
        });
      }
      if (actions.length === 0) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.ZERO_ROWS,
          error_message: `no enforcement rows in ${files.length} file(s) from ${dir}`,
          confidence: 'none',
        });
      }

      const entities = rollUpEntities(actions);
      const enforcementView = actions.map((a) => {
        const v = {};
        for (const c of ENFORCEMENT_COLUMNS) v[c] = a[c] ?? '';
        return v;
      });

      const staged = [
        ctx.tableStore.writeStaging(SOURCE, 'enforcement_actions', ENFORCEMENT_ACTION_COLUMNS, actions),
        ctx.tableStore.writeStaging(SOURCE, 'enforcement_entities', ENFORCEMENT_ENTITY_COLUMNS, entities),
        ctx.tableStore.writeStaging(SOURCE, 'enforcement', ENFORCEMENT_COLUMNS, enforcementView),
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
      warnings.push(`offline mode: loaded ${actions.length} enforcement action(s) across ${entities.length} entities`);

      return healthRecord(SOURCE, startedAt, {
        status: STATUS.OK_WITH_WARNINGS,
        records_discovered: actions.length,
        records_loaded: actions.length,
        schema_version: 'enforcement-v1',
        error_message: warnings.join(' | '),
        confidence: 'high',
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
