// Raw artifact storage: every downloaded file is stored immutably under
// raw/<source>/<YYYY-MM-DD>/<name> with a sidecar <name>.meta.json recording
// sha256, size, source URL, HTTP status, and discovery time. Duplicate
// content (same sha256 as the latest stored artifact of the same name) is
// detected so re-runs never re-store or re-process unchanged data.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export class ArtifactStore {
  constructor(baseDir, { now = new Date() } = {}) {
    this.root = join(baseDir, 'raw');
    this.now = now;
  }

  dateDir(source) {
    return join(this.root, source, this.now.toISOString().slice(0, 10));
  }

  // Returns { path, hash, size, duplicate } — duplicate=true means content is
  // identical to the most recently stored artifact with this name.
  save(source, name, buffer, meta = {}) {
    const hash = sha256(buffer);
    const latest = this.latest(source, name);
    if (latest && latest.meta.sha256 === hash) {
      return { path: latest.path, hash, size: buffer.length, duplicate: true };
    }
    const dir = this.dateDir(source);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, name);
    writeFileSync(path, buffer);
    writeFileSync(
      `${path}.meta.json`,
      JSON.stringify(
        {
          sha256: hash,
          size: buffer.length,
          storedAt: this.now.toISOString(),
          ...meta,
        },
        null,
        2,
      ),
    );
    return { path, hash, size: buffer.length, duplicate: false };
  }

  // Most recent stored artifact with this name across all date directories.
  latest(source, name) {
    const sourceDir = join(this.root, source);
    if (!existsSync(sourceDir)) return null;
    const dates = readdirSync(sourceDir).sort().reverse();
    for (const date of dates) {
      const path = join(sourceDir, date, name);
      const metaPath = `${path}.meta.json`;
      if (existsSync(path) && existsSync(metaPath)) {
        return { path, date, meta: JSON.parse(readFileSync(metaPath, 'utf8')) };
      }
    }
    return null;
  }

  list(source) {
    const sourceDir = join(this.root, source);
    if (!existsSync(sourceDir)) return [];
    const out = [];
    for (const date of readdirSync(sourceDir).sort()) {
      for (const file of readdirSync(join(sourceDir, date))) {
        if (file.endsWith('.meta.json')) continue;
        out.push({ date, name: file, path: join(sourceDir, date, file) });
      }
    }
    return out;
  }
}
