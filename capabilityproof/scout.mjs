#!/usr/bin/env node

// CapabilityProof Scout: automated source discovery and qualification.
//
// Pipeline: candidate lead -> live probe -> draft manifest (local LLM if one
// is running, deterministic fallback otherwise) -> validate -> live verify ->
// quarantine in manifests-proposed/ -> promote to manifests/ only after a
// streak of clean verifications.
//
// The LLM never decides what is trusted. It only drafts claims and test
// packs; probes and deterministic checks decide, so a small local model
// (e.g. Gemma over LM Studio at http://localhost:1234/v1) is sufficient.
//
//   node capabilityproof/scout.mjs discover            qualify new candidates
//   node capabilityproof/scout.mjs verify-proposed     re-verify quarantined sources
//   node capabilityproof/scout.mjs status              show quarantine streaks
//   node capabilityproof/scout.mjs promote --ready     promote sources with a clean streak
//   node capabilityproof/scout.mjs promote <id>        promote one source regardless of streak
//
// Env: CAPABILITYPROOF_LLM_URL (default http://localhost:1234/v1),
//      CAPABILITYPROOF_LLM_MODEL (default: first loaded model),
//      CAPABILITYPROOF_SCOUT_STREAK (default 3).

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createService, DEFAULT_MANIFEST_DIR, DEFAULT_DATA_DIR } from './lib/service.mjs';
import { validateManifest } from './lib/manifest.mjs';
import { runProbe } from './lib/probe.mjs';
import { createLlmClient, extractJson } from './lib/llm.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROPOSED_DIR = process.env.CAPABILITYPROOF_PROPOSED_DIR || path.join(HERE, 'manifests-proposed');
const MANIFEST_DIR = process.env.CAPABILITYPROOF_MANIFEST_DIR || DEFAULT_MANIFEST_DIR;
const DATA_DIR = process.env.CAPABILITYPROOF_DATA_DIR || DEFAULT_DATA_DIR;
const CANDIDATES_FILE = process.env.CAPABILITYPROOF_CANDIDATES || path.join(HERE, 'scout', 'candidates.json');
const PROMOTE_STREAK = parseInt(process.env.CAPABILITYPROOF_SCOUT_STREAK || '3', 10);

const VALID_CHECK_TYPES = ['status', 'json', 'max_latency', 'min_rows', 'fields_present', 'field_pattern', 'value_range', 'known_answer', 'freshness'];

fs.mkdirSync(PROPOSED_DIR, { recursive: true });

// --- Deterministic drafting fallback -----------------------------------------

// Find the most row-like array in the response: breadth-first, prefer the
// largest array, remember its dot-path.
export function findRowArray(body, maxDepth = 3) {
  let best = { path: null, rows: null, size: -1 };
  const queue = [{ value: body, path: '', depth: 0 }];
  while (queue.length) {
    const { value, path: p, depth } = queue.shift();
    if (Array.isArray(value)) {
      if (value.length > best.size) best = { path: p, rows: value, size: value.length };
      continue;
    }
    if (value && typeof value === 'object' && depth < maxDepth) {
      for (const k of Object.keys(value)) {
        queue.push({ value: value[k], path: p ? `${p}.${k}` : k, depth: depth + 1 });
      }
    }
  }
  return best.size >= 0 ? best : null;
}

export function draftManifestFallback(candidate, probe) {
  const checks = [
    { type: 'status', equals: 200 },
    { type: 'json' },
    { type: 'max_latency', ms: 20000 },
  ];
  const rowArray = probe.body ? findRowArray(probe.body) : null;
  if (rowArray && rowArray.size > 0) {
    checks.push({ type: 'min_rows', path: rowArray.path, min: Math.max(1, Math.floor(rowArray.size / 2)) });
    const objectRows = rowArray.rows.slice(0, 10).filter((r) => r && typeof r === 'object' && !Array.isArray(r));
    if (objectRows.length) {
      // Only require fields that every sampled row carries — first-row-only
      // inference flags optional fields (e.g. cover art ids) as missing.
      const fields = Object.keys(objectRows[0])
        .filter((k) => objectRows.every((r) => ['string', 'number', 'boolean'].includes(typeof r[k])))
        .slice(0, 4);
      if (fields.length) checks.push({ type: 'fields_present', path: rowArray.path, fields });
    }
  }
  return {
    capability_id: `source.${candidate.slug}`,
    manifest_version: '1.0',
    claim: candidate.notes || `Returns data from ${candidate.name}`,
    publisher: { name: candidate.name },
    protocol: 'rest',
    category: candidate.category || 'uncategorised',
    tags: [candidate.category].filter(Boolean),
    tasks: [candidate.notes || candidate.name],
    coverage: { countries: ['global'] },
    join_keys: [],
    auth: { type: 'none', paid: false },
    cost: { per_call_usd: 0 },
    risk_class: 'read_only',
    receipt_ttl_hours: 24,
    scouted: { drafted_by: 'fallback', drafted_at: new Date().toISOString() },
    test_pack: {
      id: `${candidate.slug}_scout_v1`,
      request: { method: 'GET', url: candidate.probe_url, ...(candidate.headers ? { headers: candidate.headers } : {}) },
      checks,
    },
    fallback_capability_ids: [],
  };
}

// --- LLM drafting -------------------------------------------------------------

const DRAFT_SYSTEM = `You draft capability manifests for a verification system. You will be given a candidate data source and a sample of its live response. Reply with ONE JSON object only, no prose, with exactly these fields:
{
  "claim": "one factual sentence: what the source returns, at what granularity, and that it needs no auth (if true)",
  "publisher": {"name": "...", "authority_url": "..."},
  "tags": ["5-8 short lowercase keywords"],
  "tasks": ["3 plain-language tasks an agent could use this source for"],
  "coverage": {"countries": ["US" or "global"], "granularity": "...", "temporal": "..."},
  "join_keys": ["stable identifier fields useful for joining, [] if none"],
  "update_frequency": "...",
  "license": "best guess, e.g. 'Public domain (US federal data)' or 'unknown'",
  "usage_notes": "one sentence of practical guidance",
  "checks": [array of checks proving the claim against the sample response]
}
Check types (use only these): status {equals}, json {}, max_latency {ms}, min_rows {path, min}, fields_present {path, fields}, field_pattern {path, field, pattern}, value_range {path, field, min, max}, known_answer {path, equals|contains|min_number|max_number}, freshness {path, max_age_hours, unit: "iso"|"epoch_ms"|"epoch_s"}.
Paths are dot-separated into the JSON response ("" = root; numeric segments index arrays). For min_rows/fields_present, path must point at an array of rows. Prefer stable checks (identifiers, formats, plausible ranges) over volatile exact values. 4-7 checks total, always starting with status and json.`;

export async function draftManifestLlm(llm, candidate, probe) {
  const sample = (probe.body_text || '').slice(0, 4000);
  const user = `Candidate: ${candidate.name}
Category: ${candidate.category}
Probe URL: ${candidate.probe_url}
Notes: ${candidate.notes}
HTTP status: ${probe.status}, latency: ${probe.latency_ms}ms
Response sample (truncated):
${sample}`;
  const raw = await llm.chat(DRAFT_SYSTEM, user);
  const draft = extractJson(raw);

  // The model proposes; we normalise and never let it set trust-relevant
  // fields like risk_class, cost, auth or the probe URL.
  const checks = (Array.isArray(draft.checks) ? draft.checks : [])
    .filter((c) => c && VALID_CHECK_TYPES.includes(c.type))
    .slice(0, 8);
  if (!checks.some((c) => c.type === 'status')) checks.unshift({ type: 'status', equals: 200 });
  if (!checks.some((c) => c.type === 'json')) checks.splice(1, 0, { type: 'json' });

  return {
    capability_id: `source.${candidate.slug}`,
    manifest_version: '1.0',
    claim: typeof draft.claim === 'string' && draft.claim.length > 10 ? draft.claim : (candidate.notes || candidate.name),
    publisher: draft.publisher?.name ? draft.publisher : { name: candidate.name },
    protocol: 'rest',
    category: candidate.category || 'uncategorised',
    tags: Array.isArray(draft.tags) ? draft.tags.slice(0, 10) : [candidate.category].filter(Boolean),
    tasks: Array.isArray(draft.tasks) ? draft.tasks.slice(0, 5) : [candidate.notes || candidate.name],
    coverage: draft.coverage && typeof draft.coverage === 'object' ? draft.coverage : { countries: ['global'] },
    join_keys: Array.isArray(draft.join_keys) ? draft.join_keys.slice(0, 6) : [],
    update_frequency: typeof draft.update_frequency === 'string' ? draft.update_frequency : undefined,
    license: typeof draft.license === 'string' ? draft.license : 'unknown',
    usage_notes: typeof draft.usage_notes === 'string' ? draft.usage_notes : undefined,
    auth: { type: 'none', paid: false },
    cost: { per_call_usd: 0 },
    risk_class: 'read_only',
    receipt_ttl_hours: 24,
    scouted: { drafted_by: 'llm', model: llm.model, drafted_at: new Date().toISOString() },
    test_pack: {
      id: `${candidate.slug}_scout_v1`,
      request: { method: 'GET', url: candidate.probe_url, ...(candidate.headers ? { headers: candidate.headers } : {}) },
      checks,
    },
    fallback_capability_ids: [],
  };
}

// --- Quarantine bookkeeping ---------------------------------------------------

function loadCandidates() {
  return JSON.parse(fs.readFileSync(CANDIDATES_FILE, 'utf-8')).candidates || [];
}

function knownIds() {
  const ids = new Set();
  for (const dir of [MANIFEST_DIR, PROPOSED_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      try { ids.add(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')).capability_id); } catch {}
    }
  }
  return ids;
}

function verifiedStreak(store, capabilityId) {
  const entries = store.getHistory(capabilityId);
  let streak = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].task_success) streak++;
    else break;
  }
  return { streak, total: entries.length };
}

function proposedFiles() {
  if (!fs.existsSync(PROPOSED_DIR)) return [];
  return fs.readdirSync(PROPOSED_DIR).filter((f) => f.endsWith('.json')).sort();
}

// --- Commands -----------------------------------------------------------------

async function discover() {
  const llm = createLlmClient();
  const llmUp = await llm.available();
  console.log(llmUp
    ? `Scout: drafting with local model "${await llm.resolveModel()}" at ${llm.baseUrl}`
    : `Scout: no LLM reachable at ${llm.baseUrl} — using deterministic fallback drafting`);

  const existing = knownIds();
  const candidates = loadCandidates().filter((c) => !existing.has(`source.${c.slug}`));
  if (candidates.length === 0) {
    console.log('No new candidates: everything in the candidate list is already registered or quarantined.');
    return;
  }

  const proposedService = createService({ manifestDir: PROPOSED_DIR, dataDir: DATA_DIR });
  let qualified = 0;
  for (const candidate of candidates) {
    console.log(`\n--- ${candidate.name} (source.${candidate.slug})`);
    const probe = await runProbe({ method: 'GET', url: candidate.probe_url, headers: candidate.headers });
    if (!probe.ok || probe.status !== 200 || probe.body === null) {
      console.log(`    discarded: probe failed (status=${probe.status}, error=${probe.error ?? 'body is not JSON'})`);
      continue;
    }

    let manifest;
    let draftedBy = 'fallback';
    if (llmUp) {
      try {
        manifest = await draftManifestLlm(llm, candidate, probe);
        draftedBy = 'llm';
      } catch (err) {
        console.log(`    LLM draft failed (${err.message}); using fallback drafting`);
      }
    }
    if (!manifest) manifest = draftManifestFallback(candidate, probe);

    const { valid, errors } = validateManifest(manifest);
    if (!valid) {
      console.log(`    discarded: drafted manifest invalid: ${errors.join('; ')}`);
      continue;
    }

    const file = path.join(PROPOSED_DIR, `${candidate.slug.replace(/\./g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));

    // Re-create the service so it sees the new manifest, then verify live.
    const svc = createService({ manifestDir: PROPOSED_DIR, dataDir: DATA_DIR });
    const { receipt } = await svc.verify(manifest.capability_id);
    console.log(`    drafted by ${draftedBy}, verification: ${receipt.status} (${receipt.results.checks_passed}/${receipt.results.checks_total} checks, ${receipt.results.latency_ms}ms)`);
    for (const f of receipt.failures) console.log(`      - ${f}`);
    if (receipt.status === 'verified') qualified++;
    console.log(`    quarantined in ${path.relative(process.cwd(), file)} — promote after a streak of ${PROMOTE_STREAK} clean verifications`);
  }
  console.log(`\nScout finished: ${qualified}/${candidates.length} new candidates verified on first probe. Run "verify-proposed" daily and "promote --ready" to graduate them.`);
  void proposedService; // service created for side effects (dirs); sweeps happen via verify-proposed
}

async function verifyProposed() {
  const svc = createService({ manifestDir: PROPOSED_DIR, dataDir: DATA_DIR });
  if (svc.manifests.size === 0) {
    console.log('Quarantine is empty.');
    return;
  }
  const results = await svc.verifyAll();
  for (const r of results) {
    const { streak } = verifiedStreak(svc.store, r.capability_id);
    console.log(`[${r.status === 'verified' ? 'PASS' : 'FAIL'}] ${r.capability_id.padEnd(40)} streak ${streak}/${PROMOTE_STREAK}`);
    for (const f of r.failures || []) console.log(`       - ${f}`);
  }
}

function status() {
  const svc = createService({ manifestDir: PROPOSED_DIR, dataDir: DATA_DIR });
  if (svc.manifests.size === 0) {
    console.log('Quarantine is empty.');
    return;
  }
  for (const m of svc.manifests.values()) {
    const { streak, total } = verifiedStreak(svc.store, m.capability_id);
    const ready = streak >= PROMOTE_STREAK ? '  READY TO PROMOTE' : '';
    console.log(`${m.capability_id.padEnd(40)} streak ${streak}/${PROMOTE_STREAK} (${total} probes, drafted by ${m.scouted?.drafted_by || '?'})${ready}`);
  }
}

function promote(args) {
  const svc = createService({ manifestDir: PROPOSED_DIR, dataDir: DATA_DIR });
  const ready = args.includes('--ready');
  const targetId = args.find((a) => !a.startsWith('--'));
  let promoted = 0;

  for (const file of proposedFiles()) {
    const full = path.join(PROPOSED_DIR, file);
    const manifest = JSON.parse(fs.readFileSync(full, 'utf-8'));
    const { streak } = verifiedStreak(svc.store, manifest.capability_id);
    const eligible = targetId ? manifest.capability_id === targetId : ready && streak >= PROMOTE_STREAK;
    if (!eligible) continue;
    if (targetId && streak < PROMOTE_STREAK) {
      console.log(`note: promoting ${manifest.capability_id} with streak ${streak}/${PROMOTE_STREAK} (explicit request)`);
    }
    fs.renameSync(full, path.join(MANIFEST_DIR, file));
    console.log(`promoted ${manifest.capability_id} -> ${path.relative(process.cwd(), MANIFEST_DIR)}/${file}`);
    promoted++;
  }
  if (promoted === 0) console.log(targetId ? `nothing promoted: ${targetId} not found in quarantine` : `nothing promoted: no source has a streak of ${PROMOTE_STREAK} yet`);
  else console.log(`\n${promoted} source(s) promoted. Commit the moved manifest file(s) to make it permanent.`);
}

// Run the CLI only when executed directly, so tests can import the drafting
// functions without triggering a discovery sweep.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...rest] = process.argv.slice(2);
  const run = { discover, 'verify-proposed': verifyProposed, status, promote: () => promote(rest) }[command || 'discover'];
  if (!run) {
    console.error('Commands: discover | verify-proposed | status | promote [--ready | <capability_id>]');
    process.exitCode = 2;
  } else {
    await run();
  }
}
