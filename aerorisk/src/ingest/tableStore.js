// Staging → production table store over CSV files.
//
// Adapters write tables to db/staging/<source>/, validation runs against
// staging, and promote() moves validated tables to db/production/ where the
// existing Datastore/report pipeline reads them. Production is only ever
// touched by a successful promote, so a failed run can never corrupt it.
//
// Schema fingerprints are persisted per table in db/schemas/<source>.json;
// a column-set change on a later run is surfaced as a schema change rather
// than silently loading different data. The CSV layer is deliberately
// isolated here so a real database can replace it without touching adapters.

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '../csv.js';

function csvField(value) {
  const v = String(value ?? '');
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(columns, rows) {
  return [
    columns.join(','),
    ...rows.map((r) => columns.map((c) => csvField(r[c])).join(',')),
  ].join('\n');
}

export class TableStore {
  constructor(baseDir) {
    this.stagingRoot = join(baseDir, 'db', 'staging');
    this.productionDir = join(baseDir, 'db', 'production');
    this.schemaDir = join(baseDir, 'db', 'schemas');
  }

  writeStaging(source, tableName, columns, rows) {
    const dir = join(this.stagingRoot, source);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${tableName}.csv`), `${toCsv(columns, rows)}\n`);
    return { table: tableName, rows: rows.length, columns };
  }

  readStaging(source, tableName) {
    const path = join(this.stagingRoot, source, `${tableName}.csv`);
    if (!existsSync(path)) return null;
    return parseCsv(readFileSync(path, 'utf8'));
  }

  // Compares each staged table's column set against the stored fingerprint.
  // Returns { changes: [...] } and updates fingerprints for new tables only;
  // changed fingerprints are persisted only after an explicit promote.
  detectSchemaChanges(source, staged) {
    const path = join(this.schemaDir, `${source}.json`);
    const known = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
    const changes = [];
    for (const t of staged) {
      const previous = known[t.table];
      if (previous && previous.join('|') !== t.columns.join('|')) {
        changes.push({
          table: t.table,
          previous,
          current: t.columns,
        });
      }
    }
    return changes;
  }

  saveSchemaFingerprints(source, staged) {
    mkdirSync(this.schemaDir, { recursive: true });
    const path = join(this.schemaDir, `${source}.json`);
    const known = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
    for (const t of staged) known[t.table] = t.columns;
    writeFileSync(path, JSON.stringify(known, null, 2));
  }

  promote(source) {
    const dir = join(this.stagingRoot, source);
    if (!existsSync(dir)) return [];
    mkdirSync(this.productionDir, { recursive: true });
    const promoted = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.csv')) continue;
      copyFileSync(join(dir, file), join(this.productionDir, file));
      promoted.push(file);
    }
    return promoted;
  }

  readProduction(tableName) {
    const path = join(this.productionDir, `${tableName}.csv`);
    if (!existsSync(path)) return null;
    return parseCsv(readFileSync(path, 'utf8'));
  }
}
