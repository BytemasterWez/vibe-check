// Capability manifests: the canonical, machine-readable description of one
// verifiable capability (a data source + a claim + a test pack that proves it).

import fs from 'fs';
import path from 'path';

export const MANIFEST_VERSION = '1.0';

const REQUIRED_FIELDS = [
  'capability_id',
  'claim',
  'publisher',
  'protocol',
  'category',
  'risk_class',
  'auth',
  'test_pack',
];

const VALID_PROTOCOLS = ['rest', 'file', 'mcp', 'a2a'];
const VALID_RISK_CLASSES = ['read_only', 'mutating'];
const VALID_CHECK_TYPES = [
  'status',
  'json',
  'max_latency',
  'min_rows',
  'unique_field',
  'fields_present',
  'field_pattern',
  'value_range',
  'known_answer',
  'freshness',
];

// A capability is experimental when it entered the catalogue via the Scout
// and no human has explicitly approved it. Trust policies gate on this:
// the Scout generates candidate contracts, it never certifies a source.
export function isExperimental(manifest) {
  return Boolean(manifest.scouted) && manifest.approved !== true;
}

export function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return { valid: false, errors: ['manifest is not an object'] };

  for (const f of REQUIRED_FIELDS) {
    if (m[f] === undefined || m[f] === null) errors.push(`missing required field: ${f}`);
  }
  if (m.capability_id && !/^[a-z0-9_.-]+$/.test(m.capability_id)) {
    errors.push(`capability_id must match [a-z0-9_.-]+: ${m.capability_id}`);
  }
  if (m.protocol && !VALID_PROTOCOLS.includes(m.protocol)) {
    errors.push(`protocol must be one of ${VALID_PROTOCOLS.join(', ')}`);
  }
  if (m.risk_class && !VALID_RISK_CLASSES.includes(m.risk_class)) {
    errors.push(`risk_class must be one of ${VALID_RISK_CLASSES.join(', ')}`);
  }
  if (m.publisher && (typeof m.publisher !== 'object' || !m.publisher.name)) {
    errors.push('publisher must be an object with at least a name');
  }
  const tp = m.test_pack;
  if (tp) {
    if (!tp.id) errors.push('test_pack.id is required');
    if (!tp.request || !tp.request.url) errors.push('test_pack.request.url is required');
    if (!Array.isArray(tp.checks) || tp.checks.length === 0) {
      errors.push('test_pack.checks must be a non-empty array');
    } else {
      tp.checks.forEach((c, i) => {
        if (!VALID_CHECK_TYPES.includes(c.type)) {
          errors.push(`test_pack.checks[${i}].type "${c.type}" is not one of ${VALID_CHECK_TYPES.join(', ')}`);
        }
      });
    }
  }
  if (m.fallback_capability_ids && !Array.isArray(m.fallback_capability_ids)) {
    errors.push('fallback_capability_ids must be an array');
  }
  return { valid: errors.length === 0, errors };
}

// Substitute ${ENV:VAR_NAME} placeholders so manifests can reference free API
// keys without committing them. Missing vars are left in place (and will make
// the probe fail visibly rather than silently).
export function substituteEnv(str, env = process.env) {
  return String(str).replace(/\$\{ENV:([A-Z0-9_]+)\}/g, (whole, name) =>
    env[name] !== undefined ? env[name] : whole
  );
}

export function loadManifests(dir) {
  const manifests = new Map();
  const problems = [];
  if (!fs.existsSync(dir)) return { manifests, problems: [`manifest dir not found: ${dir}`] };

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const full = path.join(dir, file);
    let m;
    try {
      m = JSON.parse(fs.readFileSync(full, 'utf-8'));
    } catch (err) {
      problems.push(`${file}: invalid JSON (${err.message})`);
      continue;
    }
    const { valid, errors } = validateManifest(m);
    if (!valid) {
      problems.push(`${file}: ${errors.join('; ')}`);
      continue;
    }
    if (manifests.has(m.capability_id)) {
      problems.push(`${file}: duplicate capability_id ${m.capability_id}`);
      continue;
    }
    manifests.set(m.capability_id, m);
  }
  return { manifests, problems };
}
