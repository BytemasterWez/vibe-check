// Loads the public-record dataset from a data directory of CSV files and
// exposes typed lookup helpers. The bundled data/sample directory mirrors the
// shape of the real feeds (FAA registry MASTER file, SDR extracts, NTSB CAROL
// exports, AD lists, FAA quarterly enforcement reports, ASRS exports, ASIAS
// runway-incursion and wildlife-strike summaries) so the same pipeline runs
// against a directory populated from the live sources (see src/sources/fetch.js).

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './csv.js';
import { normalizeNNumber } from './identity.js';

const FILES = {
  registry: 'registry.csv',
  registrationHistory: 'registration_history.csv',
  sdrs: 'sdr.csv',
  ntsb: 'ntsb.csv',
  ads: 'ads.csv',
  enforcement: 'enforcement.csv',
  asrs: 'asrs.csv',
  airportRisk: 'airport_risk.csv',
  flights: 'flights.csv',
};

export class Datastore {
  constructor(dir) {
    this.dir = dir;
    this.tables = {};
    for (const [name, file] of Object.entries(FILES)) {
      const path = join(dir, file);
      this.tables[name] = existsSync(path) ? parseCsv(readFileSync(path, 'utf8')) : [];
    }
  }

  registryByNNumber(nNumber) {
    const n = normalizeNNumber(nNumber);
    return this.tables.registry.find((r) => normalizeNNumber(r.N_NUMBER) === n) ?? null;
  }

  listAircraft() {
    return this.tables.registry;
  }

  historyForAircraft(nNumber) {
    const n = normalizeNNumber(nNumber);
    return this.tables.registrationHistory
      .filter((r) => normalizeNNumber(r.N_NUMBER) === n)
      .sort((a, b) => a.DATE.localeCompare(b.DATE));
  }

  sdrsForTail(nNumber) {
    const n = normalizeNNumber(nNumber);
    return this.tables.sdrs.filter((r) => normalizeNNumber(r.N_NUMBER) === n);
  }

  sdrsForModel(mfr, model, excludeNNumber) {
    const exclude = excludeNNumber ? normalizeNNumber(excludeNNumber) : null;
    return this.tables.sdrs.filter(
      (r) =>
        sameMakeModel(r, mfr, model) &&
        (!exclude || normalizeNNumber(r.N_NUMBER) !== exclude),
    );
  }

  ntsbForTail(nNumber, serial) {
    const n = normalizeNNumber(nNumber);
    return this.tables.ntsb.filter(
      (r) =>
        normalizeNNumber(r.N_NUMBER) === n ||
        (serial && r.SERIAL_NUMBER && r.SERIAL_NUMBER === serial),
    );
  }

  ntsbForModel(mfr, model, excludeNNumber) {
    const exclude = excludeNNumber ? normalizeNNumber(excludeNNumber) : null;
    return this.tables.ntsb.filter(
      (r) =>
        sameMakeModel(r, mfr, model) &&
        (!exclude || normalizeNNumber(r.N_NUMBER) !== exclude),
    );
  }

  adsForAircraft(reg) {
    return this.tables.ads.filter((ad) => {
      const airframe =
        ad.APPLIES_MFR &&
        eqLoose(ad.APPLIES_MFR, reg.MFR) &&
        (!ad.APPLIES_MODEL || modelMatches(ad.APPLIES_MODEL, reg.MODEL));
      const engine =
        ad.APPLIES_ENG_MFR &&
        eqLoose(ad.APPLIES_ENG_MFR, reg.ENG_MFR) &&
        (!ad.APPLIES_ENG_MODEL || modelMatches(ad.APPLIES_ENG_MODEL, reg.ENG_MODEL));
      return Boolean(airframe || engine);
    });
  }

  enforcementForName(name) {
    if (!name) return [];
    const tokens = significantTokens(name);
    if (tokens.length === 0) return [];
    return this.tables.enforcement.filter((r) => {
      const respondent = significantTokens(r.RESPONDENT);
      const overlap = tokens.filter((t) => respondent.includes(t));
      return overlap.length >= Math.min(2, tokens.length);
    });
  }

  asrsForContext(mfr, model, airports) {
    const airportSet = new Set((airports ?? []).map((a) => a.toUpperCase()));
    return this.tables.asrs.filter(
      (r) =>
        sameMakeModel(r, mfr, model) ||
        (r.AIRPORT && airportSet.has(r.AIRPORT.toUpperCase())),
    );
  }

  airportRisk(code) {
    if (!code) return null;
    return (
      this.tables.airportRisk.find(
        (r) => r.AIRPORT.toUpperCase() === code.toUpperCase(),
      ) ?? null
    );
  }

  flightsForTail(nNumber) {
    const n = normalizeNNumber(nNumber);
    return this.tables.flights
      .filter((r) => normalizeNNumber(r.N_NUMBER) === n)
      .sort((a, b) => a.DATE.localeCompare(b.DATE));
  }
}

function eqLoose(a, b) {
  return (a ?? '').trim().toUpperCase() === (b ?? '').trim().toUpperCase();
}

// Model designators match on shared prefix so "PA-31" applies to "PA-31-350"
// and an AD written against "172" applies to "172N".
function modelMatches(pattern, model) {
  const p = (pattern ?? '').trim().toUpperCase();
  const m = (model ?? '').trim().toUpperCase();
  if (!p || !m) return false;
  return m === p || m.startsWith(p);
}

function sameMakeModel(record, mfr, model) {
  return eqLoose(record.MFR, mfr) && modelMatches(record.MODEL, model);
}

const NAME_STOPWORDS = new Set([
  'LLC', 'INC', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'TRUSTEE',
  'TRUST', 'THE', 'OF', 'AND', 'AVIATION', 'AIR',
]);

function significantTokens(name) {
  return (name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !NAME_STOPWORDS.has(t));
}
