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
