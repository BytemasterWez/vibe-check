// Behavioural reconciliation (the honest version of the "intent-vs-reality
// black box" deep end, idea #109).
//
// The call attestation proves the *sanctioned channel*: the tool calls
// CapabilityProof mediated. It cannot, by itself, see what an agent does
// *outside* those calls — raw sockets, files, spawned processes. That requires
// kernel-level observation (eBPF/Tetragon-style), which is a different sensing
// layer and deliberately NOT something this file pretends to do.
//
// What this DOES do is the reconciliation that turns a raw kernel feed into a
// signed answer: given (a) the attestations for a session and (b) a set of
// effects some external monitor actually observed, it computes what the
// sanctioned tool calls account for and flags everything left over as
// unaccounted activity. Provenance is stated explicitly on every record:
// CapabilityProof reconciles and signs; it does not capture the observations.

import crypto from 'crypto';
import { signObject } from './signing.mjs';

export function newReconciliationId() {
  return 'rec_' + crypto.randomBytes(12).toString('base64url');
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return null; }
}

// attestations: array of stored attestation objects (the sanctioned calls).
// observed: { network_hosts?: [], files_written?: [], processes?: [] } — caller
// supplied, e.g. exported from a kernel monitor the customer runs.
export function reconcileBehavior({ session_id, attestations = [], observed = {} }, keys) {
  const sanctionedHosts = [
    ...new Set(
      attestations
        .map((a) => hostOf(a?.actual?.url))
        .filter(Boolean)
    ),
  ];

  const observedHosts = [...new Set((observed.network_hosts || []).filter(Boolean))];
  const unaccountedHosts = observedHosts.filter((h) => !sanctionedHosts.includes(h));

  // Read-only HTTP tool calls account for no file writes or process spawns, so
  // any of those observed are unaccounted by definition at this layer.
  const unaccountedFiles = [...new Set((observed.files_written || []).filter(Boolean))];
  const unaccountedProcesses = [...new Set((observed.processes || []).filter(Boolean))];

  const anyUnaccounted =
    unaccountedHosts.length > 0 || unaccountedFiles.length > 0 || unaccountedProcesses.length > 0;

  const record = {
    reconciliation_id: newReconciliationId(),
    reconciliation_version: '1.0',
    session_id: session_id || null,
    attested_at: new Date().toISOString(),
    sanctioned: {
      attestation_ids: attestations.map((a) => a?.attestation_id).filter(Boolean),
      hosts: sanctionedHosts,
    },
    observed: {
      network_hosts: observedHosts,
      files_written: observed.files_written || [],
      processes: observed.processes || [],
    },
    unaccounted: {
      network_hosts: unaccountedHosts,
      files_written: unaccountedFiles,
      processes: unaccountedProcesses,
    },
    verdict: anyUnaccounted ? 'unaccounted_activity' : 'clean',
    provenance:
      'Observed effects are caller-supplied (e.g. exported from a kernel monitor the customer operates). CapabilityProof reconciles them against its sanctioned tool calls and signs the result; it does not itself capture kernel-level activity.',
  };

  return signObject(record, keys.privateKey);
}
