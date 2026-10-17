// Flexible column mapping for feeds whose exact header names vary across
// years and site revisions (SDR yearly CSVs especially). Each normalised
// field lists candidate source headers; the first present wins. Unmapped
// essential fields are reported so a layout change surfaces as a warning or
// validation failure instead of silently empty columns.

export function normalizeHeader(name) {
  return String(name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function normalizeRowKeys(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const key = normalizeHeader(k);
    if (key) out[key] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

// candidatesByField: { FIELD: ['CANDIDATE_A', 'CANDIDATE_B', ...] } — all in
// normalised header form. Returns { mapping, missing } where mapping maps
// FIELD → actual normalised source header.
export function buildColumnMapping(normalizedHeaders, candidatesByField) {
  const present = new Set(normalizedHeaders);
  const mapping = {};
  const missing = [];
  for (const [field, candidates] of Object.entries(candidatesByField)) {
    const hit = candidates.find((c) => present.has(c));
    if (hit) mapping[field] = hit;
    else missing.push(field);
  }
  return { mapping, missing };
}

export function applyMapping(normalizedRow, mapping) {
  const out = {};
  for (const [field, sourceKey] of Object.entries(mapping)) {
    out[field] = normalizedRow[sourceKey] ?? '';
  }
  return out;
}
