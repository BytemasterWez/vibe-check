// Source health: every adapter run — success or failure — produces one
// structured record. No silent failures, no pretending. Records are appended
// to db/source_health.csv and each day's runs are rendered to
// reports/ingestion_health/YYYY-MM-DD.md.

import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { toCsv } from './tableStore.js';
import { parseCsv } from '../csv.js';

export const STATUS = {
  OK: 'OK',
  OK_WITH_WARNINGS: 'OK_WITH_WARNINGS',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  SCHEMA_CHANGED: 'SCHEMA_CHANGED',
  ZERO_ROWS: 'ZERO_ROWS',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  BLOCKED: 'BLOCKED',
  PARTIAL: 'PARTIAL',
};

export const HEALTH_COLUMNS = [
  'source_name', 'run_started_at', 'run_finished_at', 'status',
  'records_discovered', 'records_downloaded', 'records_loaded',
  'artifact_hash', 'schema_version', 'source_last_updated',
  'error_message', 'confidence',
];

export function healthRecord(sourceName, startedAt, fields) {
  return {
    source_name: sourceName,
    run_started_at: startedAt.toISOString(),
    run_finished_at: new Date().toISOString(),
    status: STATUS.OK,
    records_discovered: '',
    records_downloaded: '',
    records_loaded: '',
    artifact_hash: '',
    schema_version: '',
    source_last_updated: '',
    error_message: '',
    confidence: '',
    ...fields,
  };
}

export class HealthLog {
  constructor(baseDir, { now = new Date() } = {}) {
    this.csvPath = join(baseDir, 'db', 'source_health.csv');
    this.reportPath = join(
      baseDir, 'reports', 'ingestion_health', `${now.toISOString().slice(0, 10)}.md`,
    );
    this.now = now;
  }

  append(record) {
    mkdirSync(dirname(this.csvPath), { recursive: true });
    if (!existsSync(this.csvPath)) {
      writeFileSync(this.csvPath, `${HEALTH_COLUMNS.join(',')}\n`);
    }
    appendFileSync(this.csvPath, `${toCsv(HEALTH_COLUMNS, [record]).split('\n')[1]}\n`);
  }

  all() {
    if (!existsSync(this.csvPath)) return [];
    return parseCsv(readFileSync(this.csvPath, 'utf8'));
  }

  writeDailyReport(records) {
    mkdirSync(dirname(this.reportPath), { recursive: true });
    const lines = [
      `# Ingestion health — ${this.now.toISOString().slice(0, 10)}`,
      '',
      '| Source | Status | Discovered | Downloaded | Loaded | Confidence | Error |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...records.map((r) => {
        const cell = (v) => String(v || '—').replace(/\|/g, '\\|');
        return `| ${cell(r.source_name)} | ${cell(r.status)} | ${cell(r.records_discovered)} | ${cell(r.records_downloaded)} | ${cell(r.records_loaded)} | ${cell(r.confidence)} | ${cell(r.error_message)} |`;
      }),
      '',
      '## Detail',
      '',
    ];
    for (const r of records) {
      lines.push(
        `### ${r.source_name}`,
        '',
        `- status: **${r.status}**`,
        `- run: ${r.run_started_at} → ${r.run_finished_at}`,
        `- artifact hash: ${r.artifact_hash || 'n/a'}`,
        `- schema version: ${r.schema_version || 'n/a'}`,
        `- source last updated: ${r.source_last_updated || 'unknown'}`,
        r.error_message ? `- error: ${r.error_message}` : '- error: none',
        '',
      );
    }
    writeFileSync(this.reportPath, lines.join('\n'));
    return this.reportPath;
  }
}

// Maps a fetch-layer error to an honest status.
export function statusForFetchError(err) {
  const msg = String(err?.message ?? err);
  if (/HTTP 403|HTTP 407|CONNECT|policy/i.test(msg)) return STATUS.BLOCKED;
  return STATUS.SOURCE_UNAVAILABLE;
}
