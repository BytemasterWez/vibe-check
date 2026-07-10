// Deterministic evaluation engine.
//
// A test pack declares checks; each check inspects the probe result and passes
// or fails with a concrete detail string. No LLM is involved: schema shape,
// row counts, key formats, known answers, freshness and value ranges are all
// verifiable mechanically. This is what catches an endpoint that returns
// HTTP 200 with an HTML error page or a silently truncated dataset.

import crypto from 'crypto';

// --- Path resolution: dot-separated segments, numeric segments index arrays.
export function resolvePath(obj, path) {
  if (path === undefined || path === null || path === '' || path === '$') return obj;
  let cur = obj;
  for (const seg of String(path).split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[/^\d+$/.test(seg) ? Number(seg) : seg];
  }
  return cur;
}

// Convert an array-of-arrays table (first row = headers, e.g. Census API
// responses) into an array of objects.
export function tableToObjects(rows) {
  if (!Array.isArray(rows) || rows.length < 2 || !Array.isArray(rows[0])) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r?.[i]])));
}

export function extractRows(body, { path = '', transform = null } = {}) {
  const value = resolvePath(body, path);
  if (transform === 'array_table') return tableToObjects(value);
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

// --- Schema shape inference (for drift detection, not validation).
export function inferShape(value, depth = 0) {
  if (depth > 4) return 'any';
  if (value === null) return 'null';
  if (Array.isArray(value)) return [value.length ? inferShape(value[0], depth + 1) : 'empty'];
  const t = typeof value;
  if (t === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort().slice(0, 50)) out[k] = inferShape(value[k], depth + 1);
    return out;
  }
  return t;
}

export function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function schemaHash(body) {
  if (body === null || body === undefined) return null;
  return 'sha256:' + crypto.createHash('sha256').update(canonicalize(inferShape(body))).digest('hex');
}

// --- Individual checks. Each returns { ok, detail }.
const CHECKS = {
  status(probe, check) {
    const want = check.equals ?? 200;
    return {
      ok: probe.status === want,
      detail: probe.status === want ? `HTTP ${probe.status}` : `expected HTTP ${want}, got ${probe.status ?? probe.error}`,
    };
  },

  json(probe) {
    if (probe.body !== null) return { ok: true, detail: 'body parsed as JSON' };
    const sample = (probe.body_text || '').trim().slice(0, 120);
    return {
      ok: false,
      detail: `body is not valid JSON (starts with: ${JSON.stringify(sample)})`,
    };
  },

  max_latency(probe, check) {
    const limit = check.ms ?? 15000;
    return {
      ok: probe.latency_ms !== null && probe.latency_ms <= limit,
      detail: `latency ${probe.latency_ms}ms (limit ${limit}ms)`,
    };
  },

  min_rows(probe, check) {
    const rows = extractRows(probe.body, check);
    const ok = rows.length >= (check.min ?? 1);
    return {
      ok,
      detail: `${rows.length} rows at "${check.path ?? ''}" (minimum ${check.min ?? 1})`,
      rows_found: rows.length,
      rows_expected: check.min ?? 1,
    };
  },

  fields_present(probe, check) {
    const rows = extractRows(probe.body, check);
    if (rows.length === 0) return { ok: false, detail: `no rows at "${check.path ?? ''}" to inspect` };
    const sample = rows.slice(0, check.sample ?? 25);
    const missing = new Set();
    for (const row of sample) {
      for (const f of check.fields || []) {
        if (resolvePath(row, f) === undefined) missing.add(f);
      }
    }
    return {
      ok: missing.size === 0,
      detail: missing.size === 0
        ? `all fields present in ${sample.length} sampled rows: ${(check.fields || []).join(', ')}`
        : `missing fields in sampled rows: ${[...missing].join(', ')}`,
    };
  },

  field_pattern(probe, check) {
    const rows = extractRows(probe.body, check);
    if (rows.length === 0) return { ok: false, detail: `no rows at "${check.path ?? ''}" to inspect` };
    const re = new RegExp(check.pattern);
    const sample = rows.slice(0, check.sample ?? 50);
    const bad = [];
    for (const row of sample) {
      const v = resolvePath(row, check.field);
      if (v === undefined || v === null || !re.test(String(v))) bad.push(v);
    }
    return {
      ok: bad.length === 0,
      detail: bad.length === 0
        ? `${sample.length}/${sample.length} sampled values of "${check.field}" match ${check.pattern}`
        : `${bad.length}/${sample.length} sampled values of "${check.field}" fail ${check.pattern} (e.g. ${JSON.stringify(bad[0])})`,
    };
  },

  value_range(probe, check) {
    const rows = extractRows(probe.body, check);
    if (rows.length === 0) return { ok: false, detail: `no rows at "${check.path ?? ''}" to inspect` };
    const sample = rows.slice(0, check.sample ?? 50);
    const bad = [];
    let sentinels = 0;
    for (const row of sample) {
      const raw = resolvePath(row, check.field);
      // Documented missing-data sentinels (e.g. BLS publishes "-" for months
      // lost to a government shutdown) are counted, not treated as failures.
      if (check.allow_values?.includes(raw)) { sentinels++; continue; }
      const n = Number(raw);
      if (Number.isNaN(n)) { bad.push(JSON.stringify(raw)); continue; }
      if (check.min !== undefined && n < check.min) bad.push(n);
      if (check.max !== undefined && n > check.max) bad.push(n);
    }
    const sentinelNote = sentinels ? `, ${sentinels} declared missing-value sentinel${sentinels > 1 ? 's' : ''}` : '';
    return {
      ok: bad.length === 0,
      detail: bad.length === 0
        ? `"${check.field}" numeric and within [${check.min ?? '-inf'}, ${check.max ?? 'inf'}] for ${sample.length - sentinels}/${sample.length} rows${sentinelNote}`
        : `${bad.length}/${sample.length} values of "${check.field}" out of range (e.g. ${bad[0]})${sentinelNote}`,
    };
  },

  known_answer(probe, check) {
    const v = resolvePath(probe.body, check.path);
    if (check.equals !== undefined) {
      const ok = v === check.equals;
      return { ok, detail: ok ? `"${check.path}" === ${JSON.stringify(check.equals)}` : `"${check.path}" is ${JSON.stringify(v)}, expected ${JSON.stringify(check.equals)}` };
    }
    if (check.contains !== undefined) {
      const ok = typeof v === 'string' && v.includes(check.contains);
      return { ok, detail: ok ? `"${check.path}" contains ${JSON.stringify(check.contains)}` : `"${check.path}" (${JSON.stringify(v)?.slice(0, 80)}) does not contain ${JSON.stringify(check.contains)}` };
    }
    if (check.min_number !== undefined || check.max_number !== undefined) {
      const n = Number(v);
      const ok = !Number.isNaN(n)
        && (check.min_number === undefined || n >= check.min_number)
        && (check.max_number === undefined || n <= check.max_number);
      return { ok, detail: `"${check.path}" = ${v} (expected ${check.min_number ?? '-inf'}..${check.max_number ?? 'inf'})` };
    }
    return { ok: v !== undefined && v !== null, detail: `"${check.path}" is ${v === undefined ? 'absent' : 'present'}` };
  },

  freshness(probe, check) {
    const v = resolvePath(probe.body, check.path);
    if (v === undefined || v === null) return { ok: false, detail: `no timestamp at "${check.path}"` };
    let ts;
    if (check.unit === 'epoch_ms') ts = Number(v);
    else if (check.unit === 'epoch_s') ts = Number(v) * 1000;
    else ts = Date.parse(String(v));
    if (Number.isNaN(ts)) return { ok: false, detail: `unparseable timestamp at "${check.path}": ${JSON.stringify(v)}` };
    const ageHours = (Date.now() - ts) / 3600000;
    const ok = ageHours <= check.max_age_hours;
    return {
      ok,
      detail: `data timestamp is ${ageHours.toFixed(1)}h old (limit ${check.max_age_hours}h)`,
    };
  },
};

// Which receipt dimension each check type feeds.
const DIMENSION = {
  status: 'availability',
  json: 'availability',
  max_latency: 'availability',
  min_rows: 'completeness',
  fields_present: 'schema',
  field_pattern: 'join_keys',
  value_range: 'schema',
  known_answer: 'task',
  freshness: 'freshness',
};

export function runChecks(probe, testPack) {
  const checks = [];
  for (const def of testPack.checks) {
    const impl = CHECKS[def.type];
    let outcome;
    if (!impl) {
      outcome = { ok: false, detail: `unknown check type: ${def.type}` };
    } else if (!probe.ok && def.type !== 'status') {
      outcome = { ok: false, detail: `probe failed before evaluation: ${probe.error}` };
    } else {
      try {
        outcome = impl(probe, def);
      } catch (err) {
        outcome = { ok: false, detail: `check crashed: ${err.message}` };
      }
    }
    checks.push({
      type: def.type,
      dimension: DIMENSION[def.type] || 'task',
      critical: def.critical !== false, // checks are critical unless marked otherwise
      ok: outcome.ok,
      detail: outcome.detail,
      ...(outcome.rows_found !== undefined ? { rows_found: outcome.rows_found, rows_expected: outcome.rows_expected } : {}),
    });
  }

  const dimOk = (dim) => {
    const relevant = checks.filter((c) => c.dimension === dim);
    return relevant.length === 0 ? null : relevant.every((c) => c.ok);
  };

  const rowCheck = checks.find((c) => c.rows_found !== undefined);
  const completenessScore = rowCheck
    ? Math.min(1, rowCheck.rows_found / Math.max(1, rowCheck.rows_expected))
    : (checks.filter((c) => c.ok).length / checks.length);

  const taskSuccess = checks.filter((c) => c.critical).every((c) => c.ok);
  const failures = checks.filter((c) => !c.ok).map((c) => `${c.type} [${c.dimension}]: ${c.detail}`);

  return {
    checks,
    failures,
    results: {
      task_success: taskSuccess,
      available: dimOk('availability') !== false,
      schema_valid: dimOk('schema') ?? true,
      join_keys_valid: dimOk('join_keys') ?? true,
      freshness_valid: dimOk('freshness') ?? true,
      completeness_score: Number(completenessScore.toFixed(3)),
      checks_passed: checks.filter((c) => c.ok).length,
      checks_total: checks.length,
      latency_ms: probe.latency_ms,
    },
  };
}
