// Adapter 4 — FAA Airworthiness Directives.
//
// ADs are legally enforceable regulations under 14 CFR Part 39. Two routes:
//   api     — the Federal Register public JSON API (federalregister.gov/api/v1)
//             is the automatable discovery route: it publishes FAA AD rules
//             with document number, title, abstract, and effective date.
//   offline — a structured AD CSV (the ads.csv schema) loaded directly; this
//             is the reliable path when you already hold clean AD data (a DRS
//             export or a curated list).
//
// HONESTY: the Federal Register gives AD *rule prose*, not a clean
// make/model/engine applicability table. Applicability is therefore
// best-effort — extracted by scanning the title/abstract for registry
// makes/models — and every API-derived applicability row is tagged
// APPLICABILITY_CONFIDENCE=TEXT_MATCH so downstream never treats it as
// authoritative. The product wording stays "AD exposure found", never
// "AD non-compliance found": compliance lives in the aircraft logbooks.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '../../csv.js';
import { httpGetBuffer } from '../http.js';
import { STATUS, healthRecord, statusForFetchError } from '../health.js';
import { normalizeRowKeys, normalizeHeader } from '../columnMap.js';

const SOURCE = 'faa_ad';
export const FEDERAL_REGISTER_API =
  'https://www.federalregister.gov/api/v1/documents.json';

// Datastore-compatible view columns (must match datastore.adsForAircraft).
export const ADS_COLUMNS = [
  'AD_NUMBER', 'EFFECTIVE_DATE', 'SUBJECT', 'APPLIES_MFR', 'APPLIES_MODEL',
  'APPLIES_ENG_MFR', 'APPLIES_ENG_MODEL', 'RECURRING', 'COST_BAND', 'NOTES',
];

export const AD_DIRECTIVE_COLUMNS = [
  'AD_NUMBER', 'FR_DOCUMENT_NUMBER', 'TITLE', 'ABSTRACT', 'EFFECTIVE_DATE',
  'PUBLICATION_DATE', 'RIN', 'SOURCE_URL',
];

export const AD_APPLICABILITY_COLUMNS = [
  'AD_NUMBER', 'APPLIES_MFR', 'APPLIES_MODEL', 'APPLIES_ENG_MFR',
  'APPLIES_ENG_MODEL', 'APPLICABILITY_CONFIDENCE',
];

// AD numbers look like 2024-08-12 or 87-20-03 (2- or 4-digit year block).
const AD_NUMBER_RE = /\b(\d{2,4}-\d{2}-\d{2})\b/;

export function extractAdNumber(text) {
  const m = AD_NUMBER_RE.exec(text ?? '');
  return m ? m[1] : '';
}

// Federal Register document → normalised directive row.
function directiveFromFrDoc(doc) {
  const title = doc.title ?? '';
  const abstract = doc.abstract ?? '';
  const adNumber = extractAdNumber(title) || extractAdNumber(abstract) || '';
  return {
    AD_NUMBER: adNumber || (doc.document_number ?? ''),
    FR_DOCUMENT_NUMBER: doc.document_number ?? '',
    TITLE: title,
    ABSTRACT: abstract,
    EFFECTIVE_DATE: (doc.effective_on ?? '').slice(0, 10),
    PUBLICATION_DATE: (doc.publication_date ?? '').slice(0, 10),
    RIN: Array.isArray(doc.regulation_id_numbers) ? doc.regulation_id_numbers.join(';') : '',
    SOURCE_URL: doc.html_url ?? '',
  };
}

export function transformFrPayload(jsonText) {
  const parsed = JSON.parse(jsonText);
  const docs = Array.isArray(parsed) ? parsed : parsed.results ?? [];
  const directives = [];
  for (const doc of docs) {
    const d = directiveFromFrDoc(doc);
    if (!d.AD_NUMBER && !d.TITLE) continue;
    directives.push(d);
  }
  return directives;
}

// Best-effort applicability: scan the AD's title+abstract (normalised) for
// registry make/model tokens. Only emits rows for makes actually present in
// the loaded registry, so noise stays bounded. Tagged TEXT_MATCH.
export function inferApplicability(directive, registryVocab) {
  const haystack = normalizeHeader(`${directive.TITLE} ${directive.ABSTRACT}`);
  const rows = [];
  for (const mfr of registryVocab.makes) {
    if (!haystack.includes(mfr)) continue;
    const models = registryVocab.modelsByMake.get(mfr) ?? [];
    const matchedModels = models.filter((m) => m.length >= 3 && haystack.includes(m));
    if (matchedModels.length > 0) {
      for (const model of matchedModels) {
        rows.push({
          AD_NUMBER: directive.AD_NUMBER,
          APPLIES_MFR: registryVocab.displayMake.get(mfr) ?? mfr,
          APPLIES_MODEL: registryVocab.displayModel.get(`${mfr}|${model}`) ?? model,
          APPLIES_ENG_MFR: '',
          APPLIES_ENG_MODEL: '',
          APPLICABILITY_CONFIDENCE: 'TEXT_MATCH',
        });
      }
    } else {
      rows.push({
        AD_NUMBER: directive.AD_NUMBER,
        APPLIES_MFR: registryVocab.displayMake.get(mfr) ?? mfr,
        APPLIES_MODEL: '',
        APPLIES_ENG_MFR: '',
        APPLIES_ENG_MODEL: '',
        APPLICABILITY_CONFIDENCE: 'MAKE_TEXT_MATCH',
      });
    }
  }
  return rows;
}

function buildRegistryVocab(registry) {
  const makes = new Set();
  const displayMake = new Map();
  const displayModel = new Map();
  const modelsByMake = new Map();
  for (const r of registry) {
    const mfr = normalizeHeader(r.MFR);
    const model = normalizeHeader(r.MODEL);
    if (!mfr) continue;
    makes.add(mfr);
    if (!displayMake.has(mfr)) displayMake.set(mfr, r.MFR);
    if (!modelsByMake.has(mfr)) modelsByMake.set(mfr, new Set());
    if (model) {
      modelsByMake.get(mfr).add(model);
      displayModel.set(`${mfr}|${model}`, r.MODEL);
    }
  }
  return {
    makes: [...makes],
    displayMake,
    displayModel,
    modelsByMake: new Map([...modelsByMake].map(([k, v]) => [k, [...v]])),
  };
}

export const faaAdAdapter = {
  name: SOURCE,

  async run(ctx) {
    const startedAt = new Date();
    const warnings = [];
    let downloaded = 0;
    let structuredRows = null;

    try {
      if (ctx.options.offline) {
        // Offline: structured AD CSV(s) in the ads.csv schema — the reliable
        // path. Loaded verbatim as the authoritative applicability source.
        const dir = ctx.options.offline;
        const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csv'));
        structuredRows = [];
        for (const f of files) {
          const buffer = readFileSync(join(dir, f));
          ctx.artifactStore.save(SOURCE, f, buffer, { sourceUrl: `offline:${join(dir, f)}` });
          structuredRows.push(...parseCsv(buffer.toString('utf8')));
        }
        warnings.push(`offline mode: loaded ${structuredRows.length} structured AD row(s) from ${files.length} file(s)`);
      } else {
        // API discovery via Federal Register: FAA final rules mentioning
        // airworthiness directives. Paginated; page count is bounded by
        // --ad-pages (default 1) to keep runs predictable.
        const base = ctx.options.adApi ?? FEDERAL_REGISTER_API;
        const pages = Number(ctx.options.adPages ?? 1);
        for (let page = 1; page <= pages; page += 1) {
          const url =
            `${base}?per_page=100&page=${page}` +
            '&conditions[type]=RULE' +
            '&conditions[agencies][]=federal-aviation-administration' +
            '&conditions[term]=airworthiness+directive' +
            '&fields[]=document_number&fields[]=title&fields[]=abstract' +
            '&fields[]=effective_on&fields[]=publication_date' +
            '&fields[]=regulation_id_numbers&fields[]=html_url';
          const { buffer } = await httpGetBuffer(ctx.fetchImpl, url);
          ctx.artifactStore.save(SOURCE, `federal_register_p${page}.json`, buffer, { sourceUrl: url });
          downloaded += 1;
        }
      }

      // Transform all stored artifacts into the directive table.
      const directives = [];
      if (structuredRows) {
        // Structured CSV is already applicability-complete; synthesise
        // directive rows from it for the normalised table.
        for (const r of structuredRows) {
          directives.push({
            AD_NUMBER: r.AD_NUMBER ?? '',
            FR_DOCUMENT_NUMBER: '',
            TITLE: r.SUBJECT ?? '',
            ABSTRACT: r.NOTES ?? '',
            EFFECTIVE_DATE: r.EFFECTIVE_DATE ?? '',
            PUBLICATION_DATE: '',
            RIN: '',
            SOURCE_URL: '',
          });
        }
      } else {
        for (const artifact of ctx.artifactStore.list(SOURCE)) {
          if (!artifact.name.endsWith('.json')) continue;
          try {
            directives.push(...transformFrPayload(readFileSync(artifact.path, 'utf8')));
          } catch (err) {
            warnings.push(`${artifact.name}: JSON parse failed (${err.message})`);
          }
        }
      }

      if (directives.length === 0 && !structuredRows) {
        return healthRecord(SOURCE, startedAt, {
          status: STATUS.ZERO_ROWS,
          records_downloaded: downloaded,
          error_message: `no AD directives transformed${warnings.length ? `: ${warnings.join(' | ')}` : ''}`,
          confidence: 'none',
        });
      }

      // Deduplicate directives by AD number.
      const byAd = new Map();
      for (const d of directives) byAd.set(d.AD_NUMBER || d.FR_DOCUMENT_NUMBER, d);
      const uniqueDirectives = [...byAd.values()];

      // Applicability + the Datastore-compatible ads view.
      let applicability;
      let adsView;
      if (structuredRows) {
        // Authoritative: use the structured rows directly.
        adsView = structuredRows.map((r) => pickAdsColumns(r));
        applicability = structuredRows.map((r) => ({
          AD_NUMBER: r.AD_NUMBER ?? '',
          APPLIES_MFR: r.APPLIES_MFR ?? '',
          APPLIES_MODEL: r.APPLIES_MODEL ?? '',
          APPLIES_ENG_MFR: r.APPLIES_ENG_MFR ?? '',
          APPLIES_ENG_MODEL: r.APPLIES_ENG_MODEL ?? '',
          APPLICABILITY_CONFIDENCE: 'STRUCTURED',
        }));
      } else {
        const registry = ctx.tableStore.readProduction('aircraft_registry_current');
        if (!registry) {
          warnings.push('registry production table not available — text-match applicability skipped (run faa-registry first); ads view will be empty');
          applicability = [];
          adsView = [];
        } else {
          const vocab = buildRegistryVocab(registry);
          applicability = uniqueDirectives.flatMap((d) => inferApplicability(d, vocab));
          warnings.push(
            `applicability is best-effort TEXT_MATCH from AD prose (${applicability.length} row(s)) — verify against DRS before relying on it`,
          );
          // Build the ads view from directives + inferred applicability.
          adsView = applicability.map((a) => {
            const d = byAd.get(a.AD_NUMBER) ?? {};
            return {
              AD_NUMBER: a.AD_NUMBER,
              EFFECTIVE_DATE: d.EFFECTIVE_DATE ?? '',
              SUBJECT: d.TITLE ?? '',
              APPLIES_MFR: a.APPLIES_MFR,
              APPLIES_MODEL: a.APPLIES_MODEL,
              APPLIES_ENG_MFR: a.APPLIES_ENG_MFR,
              APPLIES_ENG_MODEL: a.APPLIES_ENG_MODEL,
              RECURRING: '',
              COST_BAND: '',
              NOTES: `Applicability inferred from AD text (${a.APPLICABILITY_CONFIDENCE}); confirm against DRS.`,
            };
          });
        }
      }

      const staged = [
        ctx.tableStore.writeStaging(SOURCE, 'airworthiness_directives', AD_DIRECTIVE_COLUMNS, uniqueDirectives),
        ctx.tableStore.writeStaging(SOURCE, 'ad_applicability', AD_APPLICABILITY_COLUMNS, applicability),
        ctx.tableStore.writeStaging(SOURCE, 'ads', ADS_COLUMNS, adsView),
      ];

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
        records_discovered: uniqueDirectives.length,
        records_downloaded: downloaded,
        records_loaded: uniqueDirectives.length,
        schema_version: 'ad-v1',
        error_message: warnings.join(' | '),
        // Text-match applicability is explicitly lower confidence than a
        // structured DRS load.
        confidence: structuredRows ? 'high' : 'low',
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

function pickAdsColumns(row) {
  const out = {};
  for (const c of ADS_COLUMNS) out[c] = row[c] ?? '';
  return out;
}
