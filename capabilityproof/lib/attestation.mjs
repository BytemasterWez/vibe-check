// Call attestations: the HTTP-layer "black box" for agent tool calls.
//
// A receipt certifies a *source*: "this capability is fit for this task right
// now." A call attestation certifies a single *call made through the resolver*:
// "the agent asked for X, the policy allowed Y, the exact request that went out
// was Z, and here is whether it stayed inside the approved envelope and came
// back valid." Because CapabilityProof itself executes the call
// (resolve-and-fetch), it observes the intent going in and the bytes coming
// out — so it can attest conformance at the HTTP layer without kernel tracing.
//
// What it attests (the sanctioned channel): the tool call it mediated stayed
// in-bounds. What it does NOT attest: anything the agent does *outside* this
// call (raw sockets, files, other processes) — that needs kernel observation
// and is deliberately out of scope for this layer.

import crypto from 'crypto';
import { canonicalize } from './evaluate.mjs';

export const ATTESTATION_VERSION = '1.0';

export function newAttestationId() {
  return 'cpa_' + crypto.randomBytes(12).toString('base64url');
}

// The only params a caller is ever allowed to influence: the {placeholders}
// the manifest's own endpoint template exposes. Host and path are never
// caller-controlled, so anything outside this set is out of envelope.
export function allowedPlaceholders(manifest) {
  const url = manifest?.endpoint?.url;
  if (!url) return [];
  const found = new Set();
  for (const m of url.matchAll(/\{(\w+)\}/g)) found.add(m[1]);
  return [...found];
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return null; }
}

// The conformance dimension — the new "did-it-do-what-it-said" checks. Each is
// a named, inspectable comparison over data CapabilityProof already holds at
// the moment of the fetch, mirroring the deterministic-check philosophy of the
// verification model rather than one opaque trust score.
export function evaluateConformance({
  manifest,
  approvedCapabilityId,
  requestedCapabilityId,
  params = {},
  actualRequest,
  resultEvaluation,
}) {
  const allowed = allowedPlaceholders(manifest);
  const suppliedKeys = Object.keys(params);
  const outOfScope = suppliedKeys.filter((k) => !allowed.includes(k));

  const declaredHost = hostOf(manifest?.endpoint?.url || manifest?.test_pack?.request?.url);
  const actualHost = hostOf(actualRequest.url);

  // A fallback is disclosed, not a violation: the resolver only ever executes
  // a capability it approved, but if the agent named a specific capability and
  // got a different (approved) one, the attestation says so out loud.
  const wasFallback = requestedCapabilityId != null && requestedCapabilityId !== approvedCapabilityId;

  const checks = {
    param_scope: {
      ok: outOfScope.length === 0,
      detail: outOfScope.length
        ? `params not declared as placeholders were supplied: ${outOfScope.join(', ')}`
        : `all ${suppliedKeys.length} supplied param(s) map to declared placeholders`,
    },
    host_locked: {
      ok: declaredHost != null && actualHost === declaredHost,
      detail:
        declaredHost != null && actualHost === declaredHost
          ? `request host ${actualHost} matches the manifest`
          : `request host ${actualHost} does not match the manifest host ${declaredHost}`,
    },
    envelope_match: {
      // The resolver structurally cannot execute an unapproved capability, so
      // this passes by construction — but attesting it turns an assumption into
      // a signed, checkable statement.
      ok: true,
      detail: wasFallback
        ? `approved a fallback (${approvedCapabilityId}) rather than the requested ${requestedCapabilityId}`
        : `used the capability that was approved (${approvedCapabilityId})`,
    },
    result_valid: {
      ok: resultEvaluation.results.task_success === true,
      detail: resultEvaluation.results.task_success
        ? 'the response passed the capability contract on this call'
        : 'the response failed the capability contract on this call',
    },
  };

  const requestInBounds = checks.param_scope.ok && checks.host_locked.ok && checks.envelope_match.ok;
  // Tri-state, and the distinction matters: out_of_envelope means the *agent*
  // stepped outside what was approved; result_unverified means the *tool*
  // misbehaved while the agent stayed in-bounds; conformant means both held.
  const verdict = !requestInBounds
    ? 'out_of_envelope'
    : checks.result_valid.ok
      ? 'conformant'
      : 'result_unverified';

  const violations = Object.entries(checks)
    .filter(([, c]) => !c.ok)
    .map(([name, c]) => ({ check: name, detail: c.detail }));

  return { checks, verdict, violations, was_fallback: wasFallback, params_used: suppliedKeys.filter((k) => allowed.includes(k)) };
}

export function buildAttestation({
  manifest,
  resolution,
  requestedCapabilityId,
  declared,
  params = {},
  actualRequest,
  probe,
  conformance,
  runnerVersion,
  evidenceHashValue,
}) {
  return {
    attestation_id: newAttestationId(),
    attestation_version: ATTESTATION_VERSION,
    capability_id: resolution.capability_id,
    attested_at: new Date().toISOString(),
    policy: resolution.policy?.name || null,
    receipt_id: resolution.receipt_id, // the pre-approval receipt this call rode on
    contract_version: resolution.contract_version,
    runner_version: runnerVersion,

    // (1) what the agent SAID it wanted
    declared: declared ?? null,
    requested_capability_id: requestedCapabilityId ?? null,

    // (2) what the policy ALLOWED
    approved: {
      capability_id: resolution.capability_id,
      allowed_placeholders: allowedPlaceholders(manifest),
      was_fallback: conformance.was_fallback,
    },

    // (3) what ACTUALLY went out and came back
    actual: {
      method: actualRequest.method,
      url: actualRequest.url,
      params_used: conformance.params_used,
      http_status: probe.status,
      latency_ms: probe.latency_ms,
      fetched_at: probe.fetched_at,
      error: probe.error,
    },

    // (4) did it stay in-bounds and return valid data
    conformance: conformance.checks,
    verdict: conformance.verdict,
    violations: conformance.violations,

    evidence_hash: evidenceHashValue,
  };
}

export function signAttestation(attestation, privateKey) {
  const unsigned = { ...attestation };
  delete unsigned.signature;
  const signature = crypto.sign(null, Buffer.from(canonicalize(unsigned)), privateKey);
  return { ...unsigned, signature: 'ed25519:' + signature.toString('base64') };
}

export function verifyAttestationSignature(attestation, publicKey) {
  if (!attestation || !attestation.signature || !attestation.signature.startsWith('ed25519:')) {
    return { valid: false, reason: 'missing or malformed signature' };
  }
  const unsigned = { ...attestation };
  delete unsigned.signature;
  const sig = Buffer.from(attestation.signature.slice('ed25519:'.length), 'base64');
  const valid = crypto.verify(null, Buffer.from(canonicalize(unsigned)), publicKey, sig);
  return { valid, reason: valid ? 'signature valid' : 'signature does not match attestation contents' };
}
