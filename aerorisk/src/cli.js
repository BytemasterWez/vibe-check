import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Datastore } from './datastore.js';
import { assessAircraft } from './assess.js';
import { renderReport } from './report.js';
import { SOURCES, fetchSource } from './sources/fetch.js';
import { transformReleasableAircraft } from './sources/transformFaaRegistry.js';
import { ADAPTERS, buildContext, runIngestion } from './ingest/runner.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = join(HERE, '..', 'data', 'sample');

const USAGE = `AeroRisk Due Diligence — public-record aircraft risk intelligence

Usage:
  aerorisk report <N-NUMBER> [--data <dir>] [--out <file>] [--json]
      Generate the Aircraft Due-Diligence Pack for one aircraft.

  aerorisk list [--data <dir>]
      List aircraft present in the loaded dataset.

  aerorisk sources
      Show the public data sources and how each feed is acquired.

  aerorisk fetch <source-id> [--dest <dir>]
      Download a source with a stable bulk endpoint (e.g. faa-registry).

  aerorisk transform faa-registry --src <dir> [--dest <dir>]
      Convert an unzipped Releasable Aircraft download (MASTER.txt,
      ACFTREF.txt, ENGINE.txt) into registry.csv in the dest data directory.

  aerorisk ingest <faa-registry|faa-sdr|ntsb|all> [options]
      Automated ingestion: discover → download → hash/store raw → transform
      → validate → stage → promote, with per-source health records.
      Options:
        --base <dir>             ingestion root (default: ./data/ingest)
        --offline <dir>          use local files instead of the network
                                 (for "all": subdirs faa_registry/ faa_sdr/ ntsb/)
        --years <from:to>        SDR year window, e.g. 1995:current
        --tails <N1,N2,...>      NTSB api-mode registration numbers
        --mode <api|bulk>        NTSB fetch mode (default api)
        --bulk-url <url>         NTSB bulk dataset URL (bulk mode)
        --accept-schema-change   promote despite a changed table schema
      After a run, generate reports from the ingested data with:
        aerorisk report <N-NUMBER> --data <base>/db/production

Options:
  --data <dir>   Data directory of CSV feeds (default: bundled sample dataset)
  --out <file>   Write the report/JSON to a file instead of stdout
  --json         Emit the structured assessment as JSON instead of markdown
`;

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'json' || key === 'accept-schema-change') args.flags[key] = true;
      else args.flags[key] = argv[++i];
    } else {
      args._.push(a);
    }
  }
  return args;
}

export async function run(argv) {
  const args = parseArgs(argv);
  const [command, target] = args._;
  const dataDir = args.flags.data ?? DEFAULT_DATA_DIR;

  switch (command) {
    case 'report': {
      if (!target) return fail('report requires an N-number, e.g. `aerorisk report N123AB`');
      const store = new Datastore(dataDir);
      const assessment = assessAircraft(store, target);
      const output = args.flags.json
        ? JSON.stringify(assessment, null, 2)
        : renderReport(assessment);
      if (args.flags.out) {
        writeFileSync(args.flags.out, `${output}\n`);
        console.log(`Wrote ${args.flags.out}`);
      } else {
        console.log(output);
      }
      return 0;
    }
    case 'list': {
      const store = new Datastore(dataDir);
      const rows = store.listAircraft();
      if (rows.length === 0) {
        console.log(`No aircraft in ${dataDir}`);
        return 0;
      }
      for (const r of rows) {
        console.log(`${r.N_NUMBER}\t${r.YEAR_MFR} ${r.MFR} ${r.MODEL}\ts/n ${r.SERIAL_NUMBER}\t${r.REGISTRANT_NAME}`);
      }
      return 0;
    }
    case 'sources': {
      for (const s of SOURCES) {
        console.log(`${s.id}\n  ${s.name}\n  ${s.url}\n  cadence: ${s.cadence}; feeds: ${s.feeds.join(', ')}; auto-download: ${s.auto ? 'yes' : 'manual export'}\n`);
      }
      return 0;
    }
    case 'fetch': {
      if (!target) return fail('fetch requires a source id — run `aerorisk sources` to list them');
      try {
        const result = await fetchSource(target, args.flags.dest ?? join(process.cwd(), 'data', 'live'));
        console.log(result.message);
        return result.downloaded ? 0 : 1;
      } catch (err) {
        return fail(`fetch failed: ${err.message}`);
      }
    }
    case 'transform': {
      if (target !== 'faa-registry') {
        return fail('transform currently supports only: faa-registry');
      }
      const src = args.flags.src;
      if (!src) return fail('transform requires --src <dir> pointing at the unzipped Releasable Aircraft files');
      const { readFileSync, writeFileSync: write, mkdirSync } = await import('node:fs');
      const read = (name) => {
        try {
          return readFileSync(join(src, name), 'latin1');
        } catch {
          throw new Error(`missing ${name} in ${src}`);
        }
      };
      try {
        const result = transformReleasableAircraft({
          masterText: read('MASTER.txt'),
          acftrefText: read('ACFTREF.txt'),
          engineText: read('ENGINE.txt'),
        });
        const dest = args.flags.dest ?? src;
        mkdirSync(dest, { recursive: true });
        const outPath = join(dest, 'registry.csv');
        write(outPath, `${result.registryCsv}\n`);
        console.log(`Wrote ${result.count} aircraft to ${outPath}`);
        for (const w of result.warnings.slice(0, 10)) console.warn(`warning: ${w}`);
        if (result.warnings.length > 10) console.warn(`…and ${result.warnings.length - 10} more warnings`);
        console.log(
          'Note: the releasable DB carries only the current registrant; ' +
            'registration_history.csv requires FAA aircraft records (CARES) and is not produced by this transform.',
        );
        return 0;
      } catch (err) {
        return fail(`transform failed: ${err.message}`);
      }
    }
    case 'ingest': {
      if (!target) {
        return fail(`ingest requires a source: ${[...ADAPTERS.keys()].join(', ')}, or all`);
      }
      const base = args.flags.base ?? join(process.cwd(), 'data', 'ingest');
      const ctx = buildContext(base, {
        options: {
          offline: args.flags.offline,
          years: args.flags.years,
          tails: args.flags.tails,
          mode: args.flags.mode,
          bulkUrl: args.flags['bulk-url'],
          acceptSchemaChange: args.flags['accept-schema-change'] ?? false,
        },
      });
      const { records, reportPath } = await runIngestion([target], ctx);
      let failed = 0;
      for (const r of records) {
        const line = `${r.source_name}: ${r.status}` +
          (r.records_loaded !== '' ? ` (${r.records_loaded} rows loaded)` : '') +
          (r.error_message ? ` — ${r.error_message}` : '');
        if (r.status === 'OK' || r.status === 'OK_WITH_WARNINGS') console.log(line);
        else {
          console.error(line);
          failed += 1;
        }
      }
      console.log(`Health report: ${reportPath}`);
      console.log(`Production tables: ${join(base, 'db', 'production')}`);
      return failed === records.length && records.length > 0 ? 1 : 0;
    }
    case undefined:
    case 'help':
    case '--help':
      console.log(USAGE);
      return 0;
    default:
      return fail(`Unknown command "${command}"\n\n${USAGE}`);
  }
}

function fail(message) {
  console.error(message);
  return 1;
}
