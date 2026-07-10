// Capability search and routing: match a task description + constraints
// against the manifest registry, then rank candidates by verified evidence
// rather than by their own claims.

import { receiptIsFresh } from './receipts.mjs';

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'that', 'can', 'current', 'find', 'get', 'retrieve', 'return', 'data', 'service']);

export function scoreManifest(manifest, taskTokens) {
  const fields = [
    [manifest.tasks?.join(' '), 3],
    [manifest.tags?.join(' '), 2],
    [manifest.claim, 2],
    [manifest.category, 2],
    [manifest.publisher?.name, 1],
    [manifest.capability_id, 1],
  ];
  let score = 0;
  const matched = new Set();
  for (const [text, weight] of fields) {
    const tokens = new Set(tokenize(text));
    for (const t of taskTokens) {
      if (tokens.has(t)) {
        score += weight;
        matched.add(t);
      }
    }
  }
  return { score, matched: [...matched] };
}

export function applyConstraints(manifest, latestReceipt, stats, constraints = {}) {
  const reasons = [];

  if (constraints.country) {
    const countries = manifest.coverage?.countries || [];
    if (!countries.includes(constraints.country) && !countries.includes('global')) {
      reasons.push(`coverage does not include ${constraints.country}`);
    }
  }
  if (constraints.join_keys?.length) {
    const have = new Set(manifest.join_keys || []);
    const missing = constraints.join_keys.filter((k) => !have.has(k));
    if (missing.length) reasons.push(`missing join keys: ${missing.join(', ')}`);
  }
  if (constraints.maximum_cost_usd !== undefined) {
    const cost = manifest.cost?.per_call_usd ?? 0;
    if (cost > constraints.maximum_cost_usd) reasons.push(`cost ${cost} exceeds maximum ${constraints.maximum_cost_usd}`);
  }
  if (constraints.no_paid_auth) {
    if (manifest.auth?.type && manifest.auth.type !== 'none' && manifest.auth.paid !== false) {
      reasons.push(`requires ${manifest.auth.type} auth`);
    }
  }
  if (constraints.minimum_success_rate !== undefined && stats.success_rate_30d !== null) {
    if (stats.success_rate_30d < constraints.minimum_success_rate) {
      reasons.push(`30d success rate ${stats.success_rate_30d} below ${constraints.minimum_success_rate}`);
    }
  }
  if (constraints.maximum_receipt_age_minutes !== undefined) {
    const verifiedAt = latestReceipt ? Date.parse(latestReceipt.verified_at) : null;
    const ageMinutes = verifiedAt ? (Date.now() - verifiedAt) / 60000 : Infinity;
    if (ageMinutes > constraints.maximum_receipt_age_minutes) {
      reasons.push(latestReceipt
        ? `latest receipt is ${Math.round(ageMinutes)} minutes old (limit ${constraints.maximum_receipt_age_minutes})`
        : 'no receipt exists yet');
    }
  }
  if (constraints.risk_class && manifest.risk_class !== constraints.risk_class) {
    reasons.push(`risk_class is ${manifest.risk_class}, wanted ${constraints.risk_class}`);
  }
  return { eligible: reasons.length === 0, reasons };
}

export function searchCapabilities({ manifests, store }, { task, constraints = {}, limit = 10 } = {}) {
  const taskTokens = tokenize(task).filter((t) => !STOPWORDS.has(t));
  const results = [];

  for (const manifest of manifests.values()) {
    const { score, matched } = scoreManifest(manifest, taskTokens);
    if (taskTokens.length > 0 && score === 0) continue;

    const latestReceipt = store.latestReceiptFor(manifest.capability_id);
    const stats = store.historyStats(manifest.capability_id);
    const { eligible, reasons } = applyConstraints(manifest, latestReceipt, stats, constraints);

    results.push({
      capability_id: manifest.capability_id,
      claim: manifest.claim,
      category: manifest.category,
      publisher: manifest.publisher?.name,
      protocol: manifest.protocol,
      risk_class: manifest.risk_class,
      auth: manifest.auth,
      cost: manifest.cost || { per_call_usd: 0 },
      match_score: score,
      matched_terms: matched,
      eligible,
      ineligible_reasons: reasons,
      verification: latestReceipt
        ? {
            receipt_id: latestReceipt.receipt_id,
            status: latestReceipt.status,
            verified_at: latestReceipt.verified_at,
            expires_at: latestReceipt.expires_at,
            receipt_fresh: receiptIsFresh(latestReceipt),
            task_success: latestReceipt.results?.task_success ?? null,
            latency_ms: latestReceipt.results?.latency_ms ?? null,
          }
        : { status: 'never_verified', receipt_fresh: false },
      history: stats,
    });
  }

  results.sort((a, b) => {
    // Verified-and-fresh beats everything; then evidence quality, then match.
    const aOk = a.eligible && a.verification.status === 'verified' && a.verification.receipt_fresh ? 1 : 0;
    const bOk = b.eligible && b.verification.status === 'verified' && b.verification.receipt_fresh ? 1 : 0;
    if (aOk !== bOk) return bOk - aOk;
    if (a.eligible !== b.eligible) return (b.eligible ? 1 : 0) - (a.eligible ? 1 : 0);
    const aRate = a.history.success_rate_30d ?? -1;
    const bRate = b.history.success_rate_30d ?? -1;
    if (aRate !== bRate) return bRate - aRate;
    if (a.match_score !== b.match_score) return b.match_score - a.match_score;
    return (a.verification.latency_ms ?? Infinity) - (b.verification.latency_ms ?? Infinity);
  });

  return results.slice(0, limit);
}
