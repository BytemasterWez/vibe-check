#!/usr/bin/env node
// Content-addressed local-data bootstrap for external evidence.
//
// Raw external datasets are never committed (they are large and human-gated).
// This script lets another authorised researcher retrieve and VERIFY the exact
// source release from the committed source manifest, so results reproduce from
// identical bytes. It only downloads; it never modifies the manifest.
//
//   node research_lab/external_bootstrap.mjs verify EXT-RR-MULTI-001
//   node research_lab/external_bootstrap.mjs fetch  EXT-RR-MULTI-001 [--only <substr>] [--limit N]
//
// `verify` checks any already-downloaded files against the manifest SHA-256.
// `fetch` downloads (missing or all) files via their recorded download_url and
// verifies each hash; mismatches abort. Use --only/--limit for a subset.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = HERE;

function manifestPath(id) {
  return path.join(ROOT, 'evidence/external/manifests', `${id}.source.json`);
}
function rawDir(id) {
  return path.join(ROOT, 'evidence/external/raw', id);
}
function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          return download(res.headers.location, dest).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          file.close();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      })
      .on('error', (e) => {
        file.close();
        fs.rmSync(dest, { force: true });
        reject(e);
      });
  });
}

const [cmd, id, ...rest] = process.argv.slice(2);
if (!cmd || !id) {
  console.error('usage: external_bootstrap.mjs <verify|fetch> <evidence_id> [--only <substr>] [--limit N]');
  process.exit(1);
}
const only = rest.includes('--only') ? rest[rest.indexOf('--only') + 1] : null;
const limit = rest.includes('--limit') ? parseInt(rest[rest.indexOf('--limit') + 1], 10) : Infinity;

const manifest = JSON.parse(fs.readFileSync(manifestPath(id), 'utf-8'));
const dir = rawDir(id);
fs.mkdirSync(dir, { recursive: true });
let files = manifest.files.filter((f) => (only ? f.filename.includes(only) : true)).slice(0, limit);

console.log(`${cmd} ${id}: ${files.length} file(s); licence ${(manifest.data_licence || {}).short_name}; doi ${manifest.doi}`);

let ok = 0;
let bad = 0;
let missing = 0;
for (const f of files) {
  const dest = path.join(dir, f.filename);
  if (cmd === 'fetch' && !fs.existsSync(dest)) {
    try {
      await download(f.download_url, dest);
    } catch (e) {
      console.error(`  DOWNLOAD FAILED ${f.filename}: ${e.message}`);
      bad++;
      continue;
    }
  }
  if (!fs.existsSync(dest)) {
    missing++;
    continue;
  }
  const got = sha256File(dest);
  if (got === f.sha256) ok++;
  else {
    console.error(`  HASH MISMATCH ${f.filename}: got ${got} want ${f.sha256}`);
    bad++;
  }
}
console.log(`verified ${ok}, mismatched ${bad}, missing ${missing}`);
process.exit(bad > 0 ? 1 : 0);
