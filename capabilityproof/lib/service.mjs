// CapabilityProof service: the shared orchestration layer behind the REST
// API, the MCP server and the CLI. Owns manifests, probes, evaluation,
// receipts, evidence and routing.

import path from 'path';
import { fileURLToPath } from 'url';
import { loadManifests } from './manifest.mjs';
import { runProbe } from './probe.mjs';
import { runChecks, schemaHash } from './evaluate.mjs';
import {
  ensureKeys,
  buildReceipt,
  signReceipt,
  verifyReceiptSignature,
  receiptIsFresh,
  evidenceHash,
} from './receipts.mjs';
import { createStore } from './store.mjs';
import { searchCapabilities } from './registry.mjs';
import { notify } from './notify.mjs';
import { resolvePolicy, applyPolicy, POLICIES } from './policy.mjs';
import { RUNNER_VERSION } from './receipts.mjs';
import { runChecks as evaluateChecks } from './evaluate.mjs';
import {
  evaluateConformance,
  buildAttestation,
  signAttestation,
  verifyAttestationSignature,
} from './attestation.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MANIFEST_DIR = path.join(HERE, '..', 'manifests');
export const DEFAULT_DATA_DIR = path.join(HERE, '..', 'data');

export function createService({ manifestDir = DEFAULT_MANIFEST_DIR, dataDir = DEFAULT_DATA_DIR, webhookUrl } = {}) {
  const { manifests, problems } = loadManifests(manifestDir);
  if (problems.length) {
    for (const p of problems) console.error(`[capabilityproof] manifest problem: ${p}`);
  }
  const store = createStore(dataDir);
  const keys = ensureKeys(dataDir);

  function listCapabilities() {
    return [...manifests.values()].map((m) => {
      const latest = store.latestReceiptFor(m.capability_id);
      return {
        capability_id: m.capability_id,
        claim: m.claim,
        category: m.category,
        publisher: m.publisher?.name,
        protocol: m.protocol,
        risk_class: m.risk_class,
        auth: m.auth,
        latest_receipt: latest
          ? { receipt_id: latest.receipt_id, status: latest.status, verified_at: latest.verified_at, fresh: receiptIsFresh(latest) }
          : null,
      };
    });
  }

  function getManifest(capabilityId) {
    return manifests.get(capabilityId) || null;
  }

  async function verify(capabilityId, { forceLiveProbe = true, ttlHours } = {}) {
    const manifest = manifests.get(capabilityId);
    if (!manifest) throw new ServiceError(404, `unknown capability: ${capabilityId}`);

    const previous = store.latestReceiptFor(capabilityId);
    if (!forceLiveProbe && previous && receiptIsFresh(previous)) {
      return { receipt: previous, cached: true };
    }

    const probe = await runProbe(manifest.test_pack.request);
    const evaluation = runChecks(probe, manifest.test_pack);
    const bodySchemaHash = schemaHash(probe.body);
    const history = store.historyStats(capabilityId);

    const evidence = {
      capability_id: capabilityId,
      test_pack: manifest.test_pack.id,
      contract_version: manifest.test_pack.contract_version || '1.0.0',
      runner_version: RUNNER_VERSION,
      // The full contract is retained so any receipt can be replayed later:
      // re-run this request, re-apply these checks, compare outcomes.
      contract: manifest.test_pack,
      request: { method: probe.method, url: probe.url },
      response: {
        http_status: probe.status,
        content_type: probe.content_type,
        latency_ms: probe.latency_ms,
        fetched_at: probe.fetched_at,
        error: probe.error,
      },
      schema_hash: bodySchemaHash,
      checks: evaluation.checks,
      body_sample: probe.body_text ? probe.body_text.slice(0, 16 * 1024) : null,
    };
    const evHash = evidenceHash(evidence);

    let receipt = buildReceipt({
      manifest,
      probe,
      evaluation,
      history: { ...history, schema_hash: bodySchemaHash },
      evidenceHashValue: evHash,
      ttlHours,
    });
    receipt = signReceipt(receipt, keys.privateKey);

    store.saveEvidence(receipt.receipt_id, { receipt_id: receipt.receipt_id, ...evidence });
    store.saveReceipt(receipt);
    store.appendHistory(capabilityId, {
      ts: receipt.verified_at,
      receipt_id: receipt.receipt_id,
      status: receipt.status,
      task_success: evaluation.results.task_success,
      latency_ms: probe.latency_ms,
      http_status: probe.status,
      schema_hash: bodySchemaHash,
    });

    // Outage/recovery/drift webhooks; delivery failure never fails the verify.
    await notify({ previous, receipt, webhookUrl });

    return { receipt, cached: false };
  }

  async function verifyAll(options = {}) {
    const out = [];
    for (const [id, manifest] of manifests.entries()) {
      if (options.skipMissingEnv) {
        const missing = (manifest.required_env || []).filter((v) => !process.env[v]);
        if (missing.length) {
          out.push({ capability_id: id, status: 'skipped', reason: `missing env: ${missing.join(', ')}` });
          continue;
        }
      }
      try {
        const { receipt } = await verify(id, options);
        out.push({ capability_id: id, status: receipt.status, receipt_id: receipt.receipt_id, latency_ms: receipt.results.latency_ms, failures: receipt.failures });
      } catch (err) {
        out.push({ capability_id: id, status: 'error', error: err.message });
      }
    }
    return out;
  }

  function search({ task, constraints, limit } = {}) {
    return searchCapabilities({ manifests, store }, { task, constraints, limit });
  }

  // Route: pick the best verified provider for a task, with calling
  // instructions and fallbacks. verify_mode:
  //   'cached' — use existing receipts only
  //   'auto'   — live-verify the top candidate if its receipt is stale (default)
  //   'live'   — always live-verify the top candidates (up to max_live_probes)
  async function route({ task, constraints = {}, verify_mode = 'auto', max_live_probes = 3 } = {}) {
    const candidates = search({ task, constraints, limit: 10 }).filter((c) => c.eligible);
    if (candidates.length === 0) {
      return { routed: false, reason: 'no eligible capabilities matched the task and constraints', candidates: search({ task, constraints, limit: 5 }) };
    }

    let probes = 0;
    for (const candidate of candidates) {
      const stale = !candidate.verification.receipt_fresh || candidate.verification.status !== 'verified';
      const shouldProbe =
        verify_mode === 'live' ? probes < max_live_probes
        : verify_mode === 'auto' ? stale && probes < max_live_probes
        : false;

      if (shouldProbe) {
        probes++;
        const { receipt } = await verify(candidate.capability_id);
        candidate.verification = {
          receipt_id: receipt.receipt_id,
          status: receipt.status,
          verified_at: receipt.verified_at,
          expires_at: receipt.expires_at,
          receipt_fresh: true,
          task_success: receipt.results.task_success,
          latency_ms: receipt.results.latency_ms,
        };
      }
      if (candidate.verification.status === 'verified' && candidate.verification.receipt_fresh) {
        const manifest = manifests.get(candidate.capability_id);
        const fallbacks = (manifest.fallback_capability_ids || [])
          .concat(candidates.map((c) => c.capability_id))
          .filter((id, i, arr) => id !== candidate.capability_id && arr.indexOf(id) === i && manifests.has(id))
          .slice(0, 3);
        return {
          routed: true,
          capability_id: candidate.capability_id,
          claim: manifest.claim,
          receipt_id: candidate.verification.receipt_id,
          verification: candidate.verification,
          instructions: {
            protocol: manifest.protocol,
            request: manifest.endpoint || manifest.test_pack.request,
            auth: manifest.auth,
            pagination: manifest.pagination || null,
            rate_limit: manifest.rate_limit || null,
            notes: manifest.usage_notes || null,
          },
          fallback_capability_ids: fallbacks,
          live_probes_used: probes,
        };
      }
    }
    return {
      routed: false,
      reason: `no candidate passed verification (verify_mode=${verify_mode}, live probes used: ${probes})`,
      candidates,
      live_probes_used: probes,
    };
  }

  // Resolve: the machine decision. Given a task (or explicit capability),
  // apply a trust policy and answer: what should I use right now, with what
  // evidence, and what are my fallbacks? Stale top candidates are re-verified
  // live (bounded) before rejection.
  async function resolve({ task, capability_id, policy, max_live_probes = 2 } = {}) {
    const { name: policyName, rules } = resolvePolicy(policy);
    const warnings = [];

    let candidateIds;
    if (capability_id) {
      if (!manifests.has(capability_id)) throw new ServiceError(404, `unknown capability: ${capability_id}`);
      candidateIds = [capability_id, ...(manifests.get(capability_id).fallback_capability_ids || [])].filter((id) => manifests.has(id));
    } else if (task) {
      candidateIds = search({ task, limit: 10 }).filter((c) => c.eligible).map((c) => c.capability_id);
    } else {
      throw new ServiceError(400, 'task or capability_id is required');
    }
    if (candidateIds.length === 0) {
      return { decision: 'rejected', reason: 'no capabilities matched the task', policy: { name: policyName, rules }, warnings };
    }

    let probes = 0;
    const evaluated = [];
    for (const id of candidateIds) {
      const manifest = manifests.get(id);
      let receipt = store.latestReceiptFor(id);
      const staleOrMissing = !receipt || receipt.status !== 'verified' || !receiptIsFresh(receipt);
      if (staleOrMissing && probes < max_live_probes) {
        probes++;
        receipt = (await verify(id)).receipt;
        warnings.push(`live-verified ${id} because its receipt was missing, stale or failing`);
      }
      const stats = store.historyStats(id);
      const streak = store.verifiedStreak(id);
      const verdict = applyPolicy({ manifest, receipt, stats, streak }, rules);
      evaluated.push({ id, manifest, receipt, verdict });
    }

    const approved = evaluated.filter((e) => e.verdict.allowed);
    if (approved.length === 0) {
      return {
        decision: 'rejected',
        reason: 'no candidate satisfied the trust policy',
        policy: { name: policyName, rules },
        candidates: evaluated.map((e) => ({ capability_id: e.id, confidence: e.verdict.confidence, blocked_by: e.verdict.reasons })),
        warnings,
        live_probes_used: probes,
      };
    }

    approved.sort((a, b) => b.verdict.confidence - a.verdict.confidence);
    const best = approved[0];
    return {
      decision: 'approved',
      capability_id: best.id,
      claim: best.manifest.claim,
      recommended_source: best.manifest.publisher?.name,
      receipt_id: best.receipt.receipt_id,
      receipt_valid_until: best.receipt.expires_at,
      contract_version: best.receipt.contract_version,
      confidence: best.verdict.confidence,
      experimental: best.receipt.experimental === true,
      instructions: {
        protocol: best.manifest.protocol,
        request: best.manifest.endpoint || best.manifest.test_pack.request,
        auth: best.manifest.auth,
        pagination: best.manifest.pagination || null,
        notes: best.manifest.usage_notes || null,
      },
      fallbacks: approved.slice(1, 4).map((e) => ({ capability_id: e.id, confidence: e.verdict.confidence })),
      policy: { name: policyName, rules },
      warnings,
      live_probes_used: probes,
    };
  }

  // Resolve, then actually execute the call against the approved source.
  // Caller-supplied params only fill {placeholders} in the manifest's own
  // endpoint template — the host and path are never caller-controlled.
  //
  // Because this function both sees the agent's declared intent and executes
  // the real call, it emits a signed *call attestation*: the HTTP-layer black
  // box recording declared-vs-approved-vs-actual and whether the call stayed in
  // the approved envelope and returned valid data. `declared` is optional (e.g.
  // the verbatim LLM tool_call) and only enriches the record.
  async function resolveAndFetch({ task, capability_id, policy, params = {}, declared } = {}) {
    const resolution = await resolve({ task, capability_id, policy });
    if (resolution.decision !== 'approved') return { resolution, fetch: null, attestation: null };

    const manifest = manifests.get(resolution.capability_id);
    let request = manifest.test_pack.request;
    if (manifest.endpoint?.url) {
      const filled = manifest.endpoint.url.replace(/\{(\w+)\}/g, (whole, key) =>
        params[key] !== undefined ? encodeURIComponent(String(params[key])) : whole
      );
      if (!/\{\w+\}/.test(filled)) {
        request = { method: manifest.endpoint.method || 'GET', url: filled, headers: manifest.test_pack.request.headers };
      } else if (Object.keys(params).length) {
        resolution.warnings.push(`endpoint template still has unfilled placeholders; used the verified test request instead`);
      }
    }
    const probe = await runProbe(request);
    const actualRequest = { method: request.method || 'GET', url: probe.url };

    // Re-run the capability's own contract against THIS call's real response —
    // not the pre-approval probe — so the attestation reflects what the agent
    // actually received.
    const resultEvaluation = evaluateChecks(probe, manifest.test_pack);
    const conformance = evaluateConformance({
      manifest,
      approvedCapabilityId: resolution.capability_id,
      requestedCapabilityId: capability_id || null,
      params,
      actualRequest,
      resultEvaluation,
    });

    const evidence = {
      capability_id: resolution.capability_id,
      contract_version: resolution.contract_version,
      runner_version: RUNNER_VERSION,
      // The full contract + the actual request are retained so the attestation
      // is replayable: re-run this exact request, re-apply these checks, diff.
      contract: manifest.test_pack,
      request: actualRequest,
      response: {
        http_status: probe.status,
        content_type: probe.content_type,
        latency_ms: probe.latency_ms,
        fetched_at: probe.fetched_at,
        error: probe.error,
      },
      checks: resultEvaluation.checks,
      body_sample: probe.body_text ? probe.body_text.slice(0, 16 * 1024) : null,
    };
    const evHash = evidenceHash(evidence);

    let attestation = buildAttestation({
      manifest,
      resolution,
      requestedCapabilityId: capability_id || null,
      declared,
      params,
      actualRequest,
      probe,
      conformance,
      runnerVersion: RUNNER_VERSION,
      evidenceHashValue: evHash,
    });
    attestation = signAttestation(attestation, keys.privateKey);
    store.saveAttestation(attestation);
    store.saveAttestationEvidence(attestation.attestation_id, { attestation_id: attestation.attestation_id, ...evidence });

    return {
      resolution,
      fetch: {
        url: probe.url,
        http_status: probe.status,
        latency_ms: probe.latency_ms,
        fetched_at: probe.fetched_at,
        error: probe.error,
        data: probe.body ?? probe.body_text,
      },
      attestation,
    };
  }

  function getAttestation(attestationId) {
    const attestation = store.getAttestation(attestationId);
    if (!attestation) throw new ServiceError(404, `unknown attestation: ${attestationId}`);
    const signature = verifyAttestationSignature(attestation, keys.publicKey);
    return { attestation, signature_check: signature };
  }

  function getAttestationEvidence(attestationId) {
    const evidence = store.getAttestationEvidence(attestationId);
    if (!evidence) throw new ServiceError(404, `no evidence for attestation: ${attestationId}`);
    return evidence;
  }

  // Replay a call attestation: prove the stored evidence is still hash-bound to
  // it, re-run the exact recorded request against the live source, re-apply the
  // contract, and diff the outcomes. A signed measurement, not just a claim.
  async function replayAttestation(attestationId) {
    const attestation = store.getAttestation(attestationId);
    if (!attestation) throw new ServiceError(404, `unknown attestation: ${attestationId}`);
    const evidence = store.getAttestationEvidence(attestationId);
    if (!evidence) throw new ServiceError(404, `no evidence for attestation: ${attestationId}`);
    if (!evidence.contract) throw new ServiceError(409, 'evidence predates contract retention; cannot replay');

    const { attestation_id, ...evidenceSansId } = evidence;
    const integrity = evidenceHash(evidenceSansId) === attestation.evidence_hash;

    const probe = await runProbe(evidence.request);
    const evaluation = evaluateChecks(probe, evidence.contract);
    const recorded = new Map((evidence.checks || []).map((c, i) => [`${i}:${c.type}`, c.ok]));
    const differences = evaluation.checks
      .map((c, i) => ({ index: i, type: c.type, recorded: recorded.get(`${i}:${c.type}`), now: c.ok, detail: c.detail }))
      .filter((d) => d.recorded !== undefined && d.recorded !== d.now);

    return {
      attestation_id: attestationId,
      capability_id: attestation.capability_id,
      contract_version: evidence.contract_version,
      runner_version_recorded: evidence.runner_version,
      runner_version_now: RUNNER_VERSION,
      evidence_integrity: integrity,
      recorded_verdict: attestation.verdict,
      replay_result_valid: evaluation.results.task_success === true,
      outcomes_match: differences.length === 0,
      differences,
      replayed_at: probe.fetched_at,
    };
  }

  // Replay: reproduce why a receipt passed. Verifies the stored evidence is
  // still hash-bound to the receipt, re-runs the recorded contract against
  // the live source, and diffs the outcomes.
  async function replay(receiptId) {
    const receipt = store.getReceipt(receiptId);
    if (!receipt) throw new ServiceError(404, `unknown receipt: ${receiptId}`);
    const evidence = store.getEvidence(receiptId);
    if (!evidence) throw new ServiceError(404, `no evidence for receipt: ${receiptId}`);
    if (!evidence.contract) throw new ServiceError(409, 'evidence predates contract retention; cannot replay');

    const { receipt_id, ...evidenceSansId } = evidence;
    const integrity = evidenceHash(evidenceSansId) === receipt.evidence_hash;

    const probe = await runProbe(evidence.contract.request);
    const evaluation = evaluateChecks(probe, evidence.contract);
    const recorded = new Map((evidence.checks || []).map((c, i) => [`${i}:${c.type}`, c.ok]));
    const differences = evaluation.checks
      .map((c, i) => ({ index: i, type: c.type, recorded: recorded.get(`${i}:${c.type}`), now: c.ok, detail: c.detail }))
      .filter((d) => d.recorded !== undefined && d.recorded !== d.now);

    return {
      receipt_id: receiptId,
      capability_id: receipt.capability_id,
      contract_version: evidence.contract_version,
      runner_version_recorded: evidence.runner_version,
      runner_version_now: RUNNER_VERSION,
      evidence_integrity: integrity,
      recorded_result: receipt.status,
      replay_result: evaluation.results.task_success ? 'verified' : 'failed_checks',
      outcomes_match: differences.length === 0,
      differences,
      replayed_at: probe.fetched_at,
    };
  }

  function getReceipt(receiptId) {
    const receipt = store.getReceipt(receiptId);
    if (!receipt) throw new ServiceError(404, `unknown receipt: ${receiptId}`);
    const signature = verifyReceiptSignature(receipt, keys.publicKey);
    return { receipt, signature_check: signature };
  }

  function getEvidence(receiptId) {
    const evidence = store.getEvidence(receiptId);
    if (!evidence) throw new ServiceError(404, `no evidence for receipt: ${receiptId}`);
    return evidence;
  }

  async function compare(capabilityIds, { forceLiveProbe = false } = {}) {
    const rows = [];
    for (const id of capabilityIds) {
      const manifest = manifests.get(id);
      if (!manifest) {
        rows.push({ capability_id: id, error: 'unknown capability' });
        continue;
      }
      const { receipt, cached } = await verify(id, { forceLiveProbe });
      rows.push({
        capability_id: id,
        claim: manifest.claim,
        status: receipt.status,
        cached,
        results: receipt.results,
        history: receipt.history,
        cost: manifest.cost || { per_call_usd: 0 },
        auth: manifest.auth,
      });
    }
    return rows;
  }

  function explainFailure(capabilityId) {
    const latest = store.latestReceiptFor(capabilityId);
    if (!latest) {
      return { capability_id: capabilityId, explanation: 'never verified — no receipts exist for this capability yet' };
    }
    if (latest.status === 'verified') {
      return {
        capability_id: capabilityId,
        receipt_id: latest.receipt_id,
        explanation: `latest probe succeeded at ${latest.verified_at}; no failure to explain`,
        results: latest.results,
      };
    }
    return {
      capability_id: capabilityId,
      receipt_id: latest.receipt_id,
      status: latest.status,
      verified_at: latest.verified_at,
      explanation:
        latest.status === 'unreachable'
          ? `the endpoint could not be reached or probed: ${latest.probe?.error || 'unknown transport error'}`
          : 'the endpoint responded but failed verification checks — see failures for the specific evidence',
      failures: latest.failures,
      probe: latest.probe,
      history: latest.history,
      fallback_capability_ids: latest.fallback_capability_ids,
    };
  }

  function findFallback(capabilityId) {
    const manifest = manifests.get(capabilityId);
    if (!manifest) throw new ServiceError(404, `unknown capability: ${capabilityId}`);
    const declared = (manifest.fallback_capability_ids || []).filter((id) => manifests.has(id));
    const sameCategory = [...manifests.values()]
      .filter((m) => m.capability_id !== capabilityId && m.category === manifest.category && !declared.includes(m.capability_id))
      .map((m) => m.capability_id);
    const describe = (id) => {
      const m = manifests.get(id);
      const latest = store.latestReceiptFor(id);
      return {
        capability_id: id,
        claim: m.claim,
        verification: latest
          ? { status: latest.status, verified_at: latest.verified_at, fresh: receiptIsFresh(latest) }
          : { status: 'never_verified' },
      };
    };
    return {
      capability_id: capabilityId,
      declared_fallbacks: declared.map(describe),
      same_category_alternatives: sameCategory.map(describe),
    };
  }

  return {
    manifests,
    manifestProblems: problems,
    store,
    publicKeyPem: keys.publicKeyPem,
    publicKey: keys.publicKey,
    listCapabilities,
    getManifest,
    verify,
    verifyAll,
    search,
    route,
    resolve,
    resolveAndFetch,
    replay,
    getAttestation,
    getAttestationEvidence,
    replayAttestation,
    policies: POLICIES,
    getReceipt,
    getEvidence,
    compare,
    explainFailure,
    findFallback,
  };
}

export class ServiceError extends Error {
  constructor(httpStatus, message) {
    super(message);
    this.httpStatus = httpStatus;
  }
}
