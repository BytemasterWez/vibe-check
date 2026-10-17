// Transforms the FAA Releasable Aircraft database download into registry.csv.
//
// The zip from https://registry.faa.gov/database/ReleasableAircraft.zip
// contains (per the FAA's ardata data dictionary):
//   MASTER.txt  — one row per registered aircraft (N-number WITHOUT the N
//                 prefix, coded make/model + engine references, YYYYMMDD
//                 dates, coded registrant type / status / certification,
//                 trailing comma on every row)
//   ACFTREF.txt — MFR MDL CODE → manufacturer/model reference
//   ENGINE.txt  — ENG MFR MDL → engine manufacturer/model reference
//
// Output matches the registry.csv schema in the README. The releasable DB
// carries only the CURRENT registrant — full chain-of-ownership history
// requires an FAA aircraft records (CARES) request and is out of scope here,
// so registration_history.csv is not produced by this transform.

import { parseCsv } from '../csv.js';
import { normalizeHeader, normalizeRowKeys } from '../ingest/columnMap.js';

const REGISTRANT_TYPES = {
  1: 'Individual',
  2: 'Partnership',
  3: 'Corporation',
  4: 'Co-Owned',
  5: 'Government',
  7: 'LLC',
  8: 'Non-Citizen Corporation',
  9: 'Non-Citizen Co-Owned',
};

const AIRWORTHINESS_CLASSES = {
  1: 'Standard',
  2: 'Limited',
  3: 'Restricted',
  4: 'Experimental',
  5: 'Provisional',
  6: 'Multiple',
  7: 'Primary',
  8: 'Special Flight Permit',
  9: 'Light Sport',
};

const STATUS_CODES = {
  V: 'Valid',
  T: 'Valid',
  E: 'Expired',
  R: 'Pending',
  W: 'Revoked',
};

function isoDate(yyyymmdd) {
  const d = (yyyymmdd ?? '').trim();
  if (!/^\d{8}$/.test(d)) return '';
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function csvField(value) {
  const v = String(value ?? '');
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// Serials vary in spacing/case/leading zeros across the MASTER and DEREG files;
// normalise before comparing so a genuine match isn't missed on formatting.
function normalizeSerial(serial) {
  return String(serial ?? '').toUpperCase().replace(/[\s-]/g, '').replace(/^0+/, '');
}

export const REGISTRY_COLUMNS = [
  'N_NUMBER', 'SERIAL_NUMBER', 'MFR', 'MODEL', 'ENG_MFR', 'ENG_MODEL',
  'YEAR_MFR', 'REGISTRANT_TYPE', 'REGISTRANT_NAME', 'CITY', 'STATE',
  'CERT_ISSUE_DATE', 'AIRWORTHINESS_CLASS', 'STATUS', 'MODE_S_HEX',
  'EXPIRATION_DATE',
];

export function transformReleasableAircraft({ masterText, acftrefText, engineText }) {
  const aircraftRef = new Map(
    parseCsv(acftrefText).map((r) => [r.CODE, { mfr: r.MFR, model: r.MODEL }]),
  );
  const engineRef = new Map(
    parseCsv(engineText).map((r) => [r.CODE, { mfr: r.MFR, model: r.MODEL }]),
  );

  const warnings = [];
  const rows = [];
  for (const m of parseCsv(masterText)) {
    const nNumber = (m['N-NUMBER'] ?? '').trim();
    if (!nNumber) continue;

    const acft = aircraftRef.get((m['MFR MDL CODE'] ?? '').trim());
    if (!acft) {
      warnings.push(`N${nNumber}: unknown MFR MDL CODE "${m['MFR MDL CODE']}" — make/model left blank`);
    }
    const eng = engineRef.get((m['ENG MFR MDL'] ?? '').trim());

    const statusCode = (m['STATUS CODE'] ?? '').trim();
    const certClass = (m.CERTIFICATION ?? '').trim().charAt(0);

    rows.push({
      N_NUMBER: `N${nNumber}`,
      SERIAL_NUMBER: (m['SERIAL NUMBER'] ?? '').trim(),
      MFR: acft?.mfr?.trim() ?? '',
      MODEL: acft?.model?.trim() ?? '',
      ENG_MFR: eng?.mfr?.trim() ?? '',
      ENG_MODEL: eng?.model?.trim() ?? '',
      YEAR_MFR: (m['YEAR MFR'] ?? '').trim(),
      REGISTRANT_TYPE: REGISTRANT_TYPES[(m['TYPE REGISTRANT'] ?? '').trim()] ?? (m['TYPE REGISTRANT'] ?? '').trim(),
      REGISTRANT_NAME: (m.NAME ?? '').trim(),
      CITY: (m.CITY ?? '').trim(),
      STATE: (m.STATE ?? '').trim(),
      CERT_ISSUE_DATE: isoDate(m['CERT ISSUE DATE']),
      AIRWORTHINESS_CLASS: AIRWORTHINESS_CLASSES[certClass] ?? certClass,
      STATUS: STATUS_CODES[statusCode] ?? statusCode,
      MODE_S_HEX: (m['MODE S CODE HEX'] ?? '').trim(),
      EXPIRATION_DATE: isoDate(m['EXPIRATION DATE']),
    });
  }

  const registryCsv = [
    REGISTRY_COLUMNS.join(','),
    ...rows.map((r) => REGISTRY_COLUMNS.map((c) => csvField(r[c])).join(',')),
  ].join('\n');

  return { registryCsv, count: rows.length, warnings };
}

// ---------------------------------------------------------------------------
// Full-bundle transform (Automated Ingestion V1)
//
// The Releasable Aircraft zip also ships DEREG.txt (deregistered aircraft),
// DOCINDEX.txt (document index), DEALER.txt, and RESERVED.txt. DEREG headers
// use hyphens where MASTER uses spaces, so all bundle parsing goes through
// normalised header keys.

// Generic pass-through: normalise headers, drop the empty trailing column the
// FAA's trailing commas produce, trim values.
function passThroughTable(text) {
  const rows = parseCsv(text).map(normalizeRowKeys);
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { columns, rows };
}

function transformDereg(deregText, aircraftRef, engineRef) {
  const rows = [];
  for (const raw of parseCsv(deregText)) {
    const r = normalizeRowKeys(raw);
    if (!r.N_NUMBER) continue;
    const acft = aircraftRef.get(r.MFR_MDL_CODE ?? '');
    const eng = engineRef.get(r.ENG_MFR_MDL ?? '');
    rows.push({
      N_NUMBER: `N${r.N_NUMBER}`,
      SERIAL_NUMBER: r.SERIAL_NUMBER ?? '',
      MFR: acft?.mfr?.trim() ?? '',
      MODEL: acft?.model?.trim() ?? '',
      ENG_MFR: eng?.mfr?.trim() ?? '',
      ENG_MODEL: eng?.model?.trim() ?? '',
      YEAR_MFR: r.YEAR_MFR ?? '',
      REGISTRANT_NAME: r.NAME ?? '',
      CITY: r.CITY ?? '',
      STATE: r.STATE ?? '',
      CANCEL_DATE: isoDate(r.CANCEL_DATE),
      LAST_ACT_DATE: isoDate(r.LAST_ACT_DATE),
      STATUS_CODE: r.STATUS_CODE ?? '',
    });
  }
  return rows;
}

export const DEREG_COLUMNS = [
  'N_NUMBER', 'SERIAL_NUMBER', 'MFR', 'MODEL', 'ENG_MFR', 'ENG_MODEL',
  'YEAR_MFR', 'REGISTRANT_NAME', 'CITY', 'STATE', 'CANCEL_DATE',
  'LAST_ACT_DATE', 'STATUS_CODE',
];

export const HISTORY_COLUMNS = ['N_NUMBER', 'DATE', 'EVENT', 'DETAILS'];

// files: { master, acftref, engine, dereg?, docindex?, dealer?, reserved? }
// Returns { tables: [{ name, columns, rows }], warnings } where tables
// include both the normalised bundle tables and the Datastore-compatible
// views (registry, registration_history).
export function transformRegistryBundle(files) {
  const warnings = [];

  const current = transformReleasableAircraft({
    masterText: files.master,
    acftrefText: files.acftref,
    engineText: files.engine,
  });
  warnings.push(...current.warnings);
  const currentRows = parseCsv(current.registryCsv);

  const aircraftRef = new Map(
    parseCsv(files.acftref).map((r) => [normalizeRowKeys(r).CODE, { mfr: r.MFR, model: r.MODEL }]),
  );
  const engineRef = new Map(
    parseCsv(files.engine).map((r) => [normalizeRowKeys(r).CODE, { mfr: r.MFR, model: r.MODEL }]),
  );

  const tables = [
    { name: 'aircraft_registry_current', columns: REGISTRY_COLUMNS, rows: currentRows },
    // Datastore-compatible view — the report pipeline reads registry.csv.
    { name: 'registry', columns: REGISTRY_COLUMNS, rows: currentRows },
  ];

  const acftrefTable = passThroughTable(files.acftref);
  tables.push({ name: 'aircraft_reference', ...acftrefTable });
  const engineTable = passThroughTable(files.engine);
  tables.push({ name: 'engine_reference', ...engineTable });

  const historyRows = [];
  if (files.dereg) {
    const deregRows = transformDereg(files.dereg, aircraftRef, engineRef);
    tables.push({ name: 'deregistered_aircraft', columns: DEREG_COLUMNS, rows: deregRows });

    // US registration marks are recycled across different airframes over the
    // decades, so a DEREG row sharing a tail number is NOT necessarily this
    // aircraft's history. Only attribute a prior deregistration to the current
    // aircraft when the serial number matches — otherwise a 1979 helicopter
    // inherits a 1938 aircraft's cancellation and scores a false signal.
    const currentSerialByN = new Map(
      currentRows.map((r) => [r.N_NUMBER, normalizeSerial(r.SERIAL_NUMBER)]),
    );
    let droppedTailReuse = 0;
    for (const d of deregRows) {
      if (!d.CANCEL_DATE) continue;
      const currentSerial = currentSerialByN.get(d.N_NUMBER);
      // No current registration for this mark → keep (nothing to conflate with).
      // Current registration exists → require a serial match.
      if (currentSerial !== undefined && currentSerial !== '') {
        if (normalizeSerial(d.SERIAL_NUMBER) !== currentSerial) {
          droppedTailReuse += 1;
          continue;
        }
      }
      historyRows.push({
        N_NUMBER: d.N_NUMBER,
        DATE: d.CANCEL_DATE,
        EVENT: 'Registration cancelled',
        DETAILS: `Previous registrant: ${d.REGISTRANT_NAME || 'unknown'}${d.STATUS_CODE ? ` (status ${d.STATUS_CODE})` : ''}`,
      });
    }
    if (droppedTailReuse > 0) {
      warnings.push(`${droppedTailReuse} deregistration row(s) excluded as tail-number reuse (serial mismatch)`);
    }
  } else {
    warnings.push('DEREG.txt not present — deregistration history unavailable');
  }
  // Registration-history view derived from deregistration records: churn and
  // cancellation signals for the registration-complexity module.
  tables.push({ name: 'registration_history', columns: HISTORY_COLUMNS, rows: historyRows });

  const optional = [
    ['docindex', 'document_index'],
    ['dealer', 'dealers'],
    ['reserved', 'reserved_n_numbers'],
  ];
  for (const [key, tableName] of optional) {
    if (files[key]) {
      tables.push({ name: tableName, ...passThroughTable(files[key]) });
    }
  }

  return { tables, warnings };
}

// Maps bundle filenames (case-insensitive) to transform inputs.
export const BUNDLE_FILES = {
  master: /^MASTER\.txt$/i,
  acftref: /^ACFTREF\.txt$/i,
  engine: /^ENGINE\.txt$/i,
  dereg: /^DEREG\.txt$/i,
  docindex: /^DOCINDEX\.txt$/i,
  dealer: /^DEALER\.txt$/i,
  reserved: /^RESERVED\.txt$/i,
};
