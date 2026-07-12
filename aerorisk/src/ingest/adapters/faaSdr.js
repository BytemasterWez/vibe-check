// Adapter 2 — FAA Service Difficulty Reports (yearly CSV files).
//
// Year links are crawled from the FAA SDR page (never hardcoded); missing or
// current-window years are downloaded incrementally; all stored years are
// re-transformed into one normalised sdr_reports table plus the aircraft/
// model/component matching layer with explicit match-confidence tiers.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '../../csv.js';
import { httpGetBuffer, httpGetText, extractLinks } from '../http.js';
import { STATUS, healthRecord, statusForFetchError } from '../health.js';
import { normalizeRowKeys, buildColumnMapping, applyMapping, normalizeHeader } from '../columnMap.js';
import { normalizeNNumber, isValidNNumber, daysAgo } from '../../identity.js';
import { chapterOf } from '../../modules/maintenance.js';

export const SDR_PAGE = 'https://sdrs.faa.gov/';
const SOURCE = 'faa_sdr';
const FIRST_YEAR = 1995;

export const MATCH_CONFIDENCE = [
  'EXACT_N_NUMBER',
  'SERIAL_MATCH',
  'MAKE_MODEL_ENGINE_MATCH',
  'MODEL_ONLY',
  'WEAK_TEXT_MATCH',
  'NO_MATCH',
];

// Candidate source headers (normalised form) per normalised field — SDR
// column names drift across years/site revisions. Extend this map when a
// new layout appears; unmapped essential fields surface as warnings.
const FIELD_CANDIDATES = {
  REPORT_ID: ['REPORT_ID', 'SDR_RECORD_ID', 'CONTROL_NUMBER', 'OPERATOR_CONTROL_NUMBER', 'SDR_NO', 'DIFFICULTY_REPORT_NO', 'C5'],
  DATE: ['DATE', 'DIFFICULTY_DATE', 'DATE_OF_DIFFICULTY', 'EVENT_DATE', 'REPORT_DATE'],
  N_NUMBER: ['N_NUMBER', 'AIRCRAFT_REGISTRATION_NUMBER', 'REGISTRY_N_NUMBER', 'REGISTRATION_NUMBER', 'REGISTRATION_NO', 'AIRCRAFT_REGISTRATION_NO'],
  SERIAL_NUMBER: ['SERIAL_NUMBER', 'AIRCRAFT_SERIAL_NUMBER', 'ACFT_SERIAL_NO', 'AIRCRAFT_SERIAL_NO'],
  MFR: ['MFR', 'AIRCRAFT_MAKE', 'ACFT_MAKE', 'MAKE'],
  MODEL: ['MODEL', 'AIRCRAFT_MODEL', 'ACFT_MODEL'],
  ENG_MFR: ['ENG_MFR', 'ENGINE_MAKE', 'ENG_MAKE'],
  ENG_MODEL: ['ENG_MODEL', 'ENGINE_MODEL'],
  JASC_CODE: ['JASC_CODE', 'ATA_CODE', 'ATA_JASC_CODE', 'JASC'],
  JASC_DESCRIPTION: ['JASC_DESCRIPTION', 'ATA_DESCRIPTION', 'JASC_DESC'],
  PART_NAME: ['PART_NAME', 'COMPONENT_NAME', 'PART'],
  SEVERITY: ['SEVERITY', 'PRECAUTIONARY_PROCEDURE', 'STAGE_OF_OPERATION'],
  NARRATIVE: ['NARRATIVE', 'DISCREPANCY', 'REMARKS', 'TEXT', 'DIFFICULTY_DESCRIPTION', 'PROBLEM_DESCRIPTION'],
};
const ESSENTIAL_FIELDS = ['DATE', 'MFR', 'MODEL'];

export const SDR_COLUMNS = [
  'REPORT_ID', 'DATE', 'N_NUMBER', 'SERIAL_NUMBER', 'MFR', 'MODEL',
  'ENG_MFR', 'ENG_MODEL', 'JASC_CODE', 'JASC_DESCRIPTION', 'PART_NAME',
  'SEVERITY', 'NARRATIVE', 'SOURCE_YEAR',
];

export const faaSdrAdapter = {
  name: SOURCE,

  async run(ctx) {
    const startedAt = new Date();
    const warnings = [];
    let discovered = 0;
    let downloaded = 0;

    try {
      if (ctx.options.offline) {
        // Offline mode: directory of yearly CSVs; year inferred from filename.
        const dir = ctx.options.offline;
        const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csv'));
        discovered = files.length;
        for (const f of files) {
          const year = (f.match(/(19|20)\d{2}/) ?? ['unknown'])[0];
          const buffer = readFileSync(join(dir, f));
          ctx.artifactStore.save(SOURCE, `sdr_${year}.csv`, buffer, {
            sourceUrl: `offline:${join(dir, f)}`,
            year,
          });
        }
        warnings.push(`offline mode: loaded ${files.length} yearly file(s) from ${dir}`);
      } else {
        const links = await discoverYearLinks(ctx);
        discovered = links.length;
        if (links.length === 0) {
          return healthRecord(SOURCE, startedAt, {
            status: STATUS.SOURCE_UNAVAILABLE,
            records_discovered: 0,
            error_message: `no yearly CSV links discovered on ${ctx.options.sdrPage ?? SDR_PAGE} — page layout may have changed`,
            confidence: 'none',
          });
        }
        const { from, to } = yearRange(ctx.options.years, ctx.now);
        for (const { year, url } of links) {
          if (year < from || year > to) continue;
          const name = `sdr_${year}.csv`;
          const existing = ctx.artifactStore.latest(SOURCE, name);
          // Incremental: closed years already stored are never re-downloaded;
          // the current and previous year are re-fetched and deduped by hash.
          const closedYear = year < ctx.now.getUTCFullYear() - 1;
          if (existing && closedYear) continue;
          const { buffer, status } = await httpGetBuffer(ctx.fetchImpl, url);
          const saved = ctx.artifactStore.save(SOURCE, name, buffer, {
            sourceUrl: url,
            httpStatus: status,
            year,
            discoveredAt: new Date().toISOString(),
          });
          if (!saved.duplicate) downloaded += 1;
        }
      }

      // Transform ALL stored yearly artifacts into one normalised table.
      const artifacts = ctx.artifactStore.list(SOURCE).filter((a) => a.name.endsWith('.csv'));
      if (artifacts.length === 0) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.ZERO_ROWS,
          records_discovered: discovered,
          records_downloaded: downloaded,
          error_message: 'no SDR artifacts stored',
          confidence: 'none',
        });
      }

      const reports = [];
      const sourceFiles = [];
      for (const artifact of artifacts) {
        const year = (artifact.name.match(/(19|20)\d{2}/) ?? ['unknown'])[0];
        const text = readFileSync(artifact.path, 'utf8');
        const rawRows = parseCsv(text);
        sourceFiles.push({ YEAR: year, FILE: artifact.name, ROWS: rawRows.length, PATH: artifact.path });
        if (rawRows.length === 0) {
          warnings.push(`${artifact.name}: zero data rows`);
          continue;
        }
        const headers = Object.keys(normalizeRowKeys(rawRows[0]));
        const { mapping, missing } = buildColumnMapping(headers, FIELD_CANDIDATES);
        const essentialMissing = missing.filter((f) => ESSENTIAL_FIELDS.includes(f));
        if (essentialMissing.length > 0) {
          warnings.push(
            `${artifact.name}: unmapped essential columns ${essentialMissing.join(', ')} (headers: ${headers.slice(0, 8).join(', ')}…) — year skipped, extend FIELD_CANDIDATES`,
          );
          continue;
        }
        for (const raw of rawRows) {
          const mapped = applyMapping(normalizeRowKeys(raw), mapping);
          mapped.N_NUMBER = mapped.N_NUMBER ? normalizeNNumber(mapped.N_NUMBER) : '';
          mapped.SOURCE_YEAR = year;
          if (!mapped.REPORT_ID) mapped.REPORT_ID = `${year}-${reports.length + 1}`;
          reports.push(mapped);
        }
      }

      if (reports.length === 0) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.ZERO_ROWS,
          records_discovered: discovered,
          records_downloaded: downloaded,
          error_message: `0 reports transformed from ${artifacts.length} artifact(s): ${warnings.join(' | ')}`,
          confidence: 'none',
        });
      }

      const staged = [
        ctx.tableStore.writeStaging(SOURCE, 'sdr_reports', SDR_COLUMNS, reports),
        // Datastore-compatible view for the report pipeline.
        ctx.tableStore.writeStaging(SOURCE, 'sdr', SDR_COLUMNS, reports),
        ctx.tableStore.writeStaging(
          SOURCE, 'sdr_source_files', ['YEAR', 'FILE', 'ROWS', 'PATH'], sourceFiles,
        ),
      ];

      // Matching layer needs the promoted registry.
      const registry = ctx.tableStore.readProduction('aircraft_registry_current');
      if (registry) {
        const { matches, patterns } = buildMatchLayer(reports, registry, ctx.now);
        staged.push(
          ctx.tableStore.writeStaging(
            SOURCE, 'sdr_aircraft_matches',
            ['REPORT_ID', 'SDR_N_NUMBER', 'MATCHED_N_NUMBER', 'CONFIDENCE'], matches,
          ),
          ctx.tableStore.writeStaging(
            SOURCE, 'sdr_model_patterns',
            ['MFR', 'MODEL', 'JASC_CHAPTER', 'REPORT_COUNT', 'RECENT_COUNT'], patterns,
          ),
        );
      } else {
        warnings.push('registry production table not available — aircraft match layer skipped (run faa-registry first)');
      }

      const schemaChanges = ctx.tableStore.detectSchemaChanges(SOURCE, staged);
      if (schemaChanges.length > 0 && !ctx.options.acceptSchemaChange) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.SCHEMA_CHANGED,
          records_discovered: discovered,
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
        records_discovered: discovered,
        records_downloaded: downloaded,
        records_loaded: reports.length,
        schema_version: 'sdr-v1',
        error_message: warnings.join(' | '),
        confidence: registryAvailableConfidence(ctx),
      });
    } catch (err) {
      return healthRecord(SOURCE, startedAt, {
        status: statusForFetchError(err),
        records_discovered: discovered,
        records_downloaded: downloaded,
        error_message: String(err.message ?? err),
        confidence: 'none',
      });
    }
  },
};

async function discoverYearLinks(ctx) {
  const page = ctx.options.sdrPage ?? SDR_PAGE;
  const { text } = await httpGetText(ctx.fetchImpl, page);
  const links = extractLinks(text, page)
    .filter((href) => /\.(csv|zip)(\?|$)/i.test(href))
    .map((href) => {
      const year = Number((href.match(/(19|20)\d{2}/) ?? [NaN])[0]);
      return { href, year };
    })
    .filter(({ year }) => Number.isInteger(year) && year >= FIRST_YEAR);
  // Deduplicate by year, keeping the first link per year.
  const byYear = new Map();
  for (const { href, year } of links) {
    if (!byYear.has(year)) byYear.set(year, href);
  }
  return [...byYear.entries()].map(([year, url]) => ({ year, url })).sort((a, b) => a.year - b.year);
}

export function yearRange(spec, now = new Date()) {
  const current = now.getUTCFullYear();
  if (!spec) return { from: FIRST_YEAR, to: current };
  const [fromRaw, toRaw] = String(spec).split(':');
  const from = Number(fromRaw) || FIRST_YEAR;
  const to = toRaw === 'current' || toRaw === undefined ? current : Number(toRaw) || current;
  return { from, to };
}

// Match-confidence tiers per the ingestion spec. Tail evidence and model
// evidence stay separated downstream; this layer only classifies linkage.
export function classifyMatch(report, registryIndex) {
  if (report.N_NUMBER && isValidNNumber(report.N_NUMBER)) {
    if (registryIndex.byN.has(report.N_NUMBER)) {
      return { matched: report.N_NUMBER, confidence: 'EXACT_N_NUMBER' };
    }
  }
  if (report.SERIAL_NUMBER && registryIndex.bySerial.has(report.SERIAL_NUMBER)) {
    return { matched: registryIndex.bySerial.get(report.SERIAL_NUMBER), confidence: 'SERIAL_MATCH' };
  }
  const modelKey = `${normalizeHeader(report.MFR)}|${normalizeHeader(report.MODEL)}`;
  if (registryIndex.byModel.has(modelKey)) {
    const engKey = `${modelKey}|${normalizeHeader(report.ENG_MODEL)}`;
    if (report.ENG_MODEL && registryIndex.byModelEngine.has(engKey)) {
      return { matched: '', confidence: 'MAKE_MODEL_ENGINE_MATCH' };
    }
    return { matched: '', confidence: 'MODEL_ONLY' };
  }
  if (report.NARRATIVE) {
    // Compare in normalised form so "PA-31-350" in free text matches the
    // registry model token "PA_31_350".
    const narrative = normalizeHeader(report.NARRATIVE);
    if (registryIndex.modelTokens.some((t) => narrative.includes(t))) {
      return { matched: '', confidence: 'WEAK_TEXT_MATCH' };
    }
  }
  return { matched: '', confidence: 'NO_MATCH' };
}

function buildMatchLayer(reports, registry, now) {
  const registryIndex = {
    byN: new Map(registry.map((r) => [normalizeNNumber(r.N_NUMBER), r])),
    bySerial: new Map(
      registry.filter((r) => r.SERIAL_NUMBER).map((r) => [r.SERIAL_NUMBER, normalizeNNumber(r.N_NUMBER)]),
    ),
    byModel: new Set(registry.map((r) => `${normalizeHeader(r.MFR)}|${normalizeHeader(r.MODEL)}`)),
    byModelEngine: new Set(
      registry.map((r) => `${normalizeHeader(r.MFR)}|${normalizeHeader(r.MODEL)}|${normalizeHeader(r.ENG_MODEL)}`),
    ),
    modelTokens: [...new Set(registry.map((r) => normalizeHeader(r.MODEL)).filter((m) => m.length >= 4))],
  };

  const matches = reports.map((r) => {
    const { matched, confidence } = classifyMatch(r, registryIndex);
    return {
      REPORT_ID: r.REPORT_ID,
      SDR_N_NUMBER: r.N_NUMBER,
      MATCHED_N_NUMBER: matched,
      CONFIDENCE: confidence,
    };
  });

  // Model-level defect theme summaries by JASC chapter.
  const patternMap = new Map();
  for (const r of reports) {
    if (!r.MFR || !r.MODEL) continue;
    const key = `${r.MFR}|${r.MODEL}|${chapterOf(r.JASC_CODE)}`;
    if (!patternMap.has(key)) {
      patternMap.set(key, { MFR: r.MFR, MODEL: r.MODEL, JASC_CHAPTER: chapterOf(r.JASC_CODE), REPORT_COUNT: 0, RECENT_COUNT: 0 });
    }
    const p = patternMap.get(key);
    p.REPORT_COUNT += 1;
    const age = daysAgo(r.DATE, now);
    if (age !== null && age <= 3 * 365) p.RECENT_COUNT += 1;
  }

  return { matches, patterns: [...patternMap.values()] };
}

function registryAvailableConfidence(ctx) {
  return ctx.tableStore.readProduction('aircraft_registry_current') ? 'high' : 'medium';
}
