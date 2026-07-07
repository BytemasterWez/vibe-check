import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Datastore } from './datastore.js';
import { assessAircraft } from './assess.js';
import { renderReport } from './report.js';
import { SOURCES, fetchSource } from './sources/fetch.js';

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
      if (key === 'json') args.flags.json = true;
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
