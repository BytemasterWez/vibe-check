// Live data-source acquisition scaffold.
//
// The MVP runs entirely from a local data directory. This module documents the
// real public feeds and automates the ones with stable bulk-download URLs.
// Everything downloaded here still needs a transform step into the CSV schema
// under data/ (see README "Loading real data").
//
// Licensing note: FAA/NTSB/NASA sources below are US-government public data.
// ADS-B history is NOT free public raw material — OpenSky requires a written
// licence for commercial use and ADS-B Exchange data is licensed product.
// Only load flight-activity data you have the rights to use.

import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const SOURCES = [
  {
    id: 'faa-registry',
    name: 'FAA aircraft registration database (Releasable Aircraft)',
    url: 'https://registry.faa.gov/database/ReleasableAircraft.zip',
    cadence: 'refreshed daily',
    feeds: ['registry.csv', 'registration_history.csv'],
    auto: true,
  },
  {
    id: 'faa-sdr',
    name: 'FAA Service Difficulty Reports (yearly CSV extracts)',
    url: 'https://sdrs.faa.gov/',
    cadence: 'yearly files, updated continuously',
    feeds: ['sdr.csv'],
    auto: false,
  },
  {
    id: 'ntsb-carol',
    name: 'NTSB CAROL aviation accident/incident database (1962–present)',
    url: 'https://data.ntsb.gov/carol-main-public/basic-search',
    cadence: 'monthly public exports',
    feeds: ['ntsb.csv'],
    auto: false,
  },
  {
    id: 'faa-ad',
    name: 'FAA Airworthiness Directives (Dynamic Regulatory System)',
    url: 'https://drs.faa.gov/',
    cadence: 'as issued',
    feeds: ['ads.csv'],
    auto: false,
  },
  {
    id: 'faa-enforcement',
    name: 'FAA quarterly enforcement action compilations',
    url: 'https://www.faa.gov/about/office_org/headquarters_offices/agc/practice_areas/enforcement/reports',
    cadence: 'quarterly',
    feeds: ['enforcement.csv'],
    auto: false,
  },
  {
    id: 'nasa-asrs',
    name: 'NASA Aviation Safety Reporting System (ASRS) database exports',
    url: 'https://asrs.arc.nasa.gov/search/database.html',
    cadence: 'periodic; voluntary/unverified narratives',
    feeds: ['asrs.csv'],
    auto: false,
  },
  {
    id: 'faa-runway-incursions',
    name: 'FAA ASIAS runway incursion data',
    url: 'https://www.asias.faa.gov/',
    cadence: 'ongoing',
    feeds: ['airport_risk.csv'],
    auto: false,
  },
  {
    id: 'faa-wildlife',
    name: 'FAA Wildlife Strike Database',
    url: 'https://wildlife.faa.gov/',
    cadence: 'ongoing',
    feeds: ['airport_risk.csv'],
    auto: false,
  },
  {
    id: 'flight-activity',
    name: 'Historical flight activity (licensed ADS-B export or operator logs)',
    url: '(licensed source — verify terms before loading)',
    cadence: 'per licence',
    feeds: ['flights.csv'],
    auto: false,
  },
];

export async function fetchSource(id, destDir) {
  const source = SOURCES.find((s) => s.id === id);
  if (!source) throw new Error(`Unknown source "${id}". Known: ${SOURCES.map((s) => s.id).join(', ')}`);
  if (!source.auto) {
    return {
      downloaded: false,
      message:
        `${source.name} has no stable bulk-download endpoint; export it manually from ${source.url} ` +
        `and transform into ${source.feeds.join(', ')} (schemas in README).`,
    };
  }

  await mkdir(destDir, { recursive: true });
  const filename = source.url.split('/').at(-1);
  const dest = join(destDir, filename);
  const res = await fetch(source.url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status} from ${source.url}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  return {
    downloaded: true,
    message: `Saved ${dest}. Unzip it and transform MASTER/DEREG files into registry.csv / registration_history.csv (schemas in README).`,
  };
}
