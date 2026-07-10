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
