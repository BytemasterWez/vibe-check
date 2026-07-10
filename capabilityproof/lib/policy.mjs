// Trust policies: different consumers have different risk tolerances.
// A policy turns the registry from a directory into a decision-control
// layer — the caller states requirements, the resolver enforces them.

import { isExperimental } from './manifest.mjs';
import { receiptIsFresh } from './receipts.mjs';

export const POLICIES = {
  // For workflows where a wrong answer costs money: fresh evidence, a track
  // record, and no Scout-admitted sources without human approval.
  production: {
    maximum_receipt_age_minutes: 24 * 60,
    minimum_consecutive_passes: 3,
    minimum_success_rate_30d: 0.9,
    minimum_confidence: 0.9,
    allow_experimental_sources: false,
  },
  // Sensible default: verified evidence required, experimental allowed.
  standard: {
    maximum_receipt_age_minutes: 48 * 60,
    minimum_consecutive_passes: 1,
    minimum_confidence: 0.75,
    allow_experimental_sources: true,
  },
  // Exploration: anything with a verified receipt qualifies.
  permissive: {
    allow_experimental_sources: true,
  },
};

export function resolvePolicy(input) {
  if (!input) return { name: 'standard', rules: POLICIES.standard };
  if (typeof input === 'string') {
    if (!POLICIES[input]) throw new Error(`unknown policy "${input}" (known: ${Object.keys(POLICIES).join(', ')})`);
    return { name: input, rules: POLICIES[input] };
  }
  return { name: 'custom', rules: input };
}

// Transparent confidence score, not a mystery number:
//   60% weight — latest receipt's check pass ratio (what just happened)
//   40% weight — 30-day verified success rate (track record; falls back to
//                the check ratio when there is no history yet)
export function confidenceFor(receipt, stats = {}) {
  if (!receipt || !receipt.results) return 0;
  const checkRatio = receipt.results.checks_total
    ? receipt.results.checks_passed / receipt.results.checks_total
    : 0;
  const history = stats.success_rate_30d ?? checkRatio;
  return Number((checkRatio * 0.6 + history * 0.4).toFixed(3));
}

// Evaluate one capability against a policy. Returns every violated rule so
// a rejection is explainable, not just a "no".
export function applyPolicy({ manifest, receipt, stats = {}, streak = 0 }, rules) {
  const reasons = [];

  if (!receipt) {
    reasons.push('no receipt exists — capability has never been verified');
  } else {
    if (receipt.status !== 'verified') reasons.push(`latest receipt status is ${receipt.status}`);
    if (!receiptIsFresh(receipt)) reasons.push(`receipt expired at ${receipt.expires_at}`);
    if (rules.maximum_receipt_age_minutes !== undefined) {
      const ageMin = (Date.now() - Date.parse(receipt.verified_at)) / 60000;
      if (ageMin > rules.maximum_receipt_age_minutes) {
        reasons.push(`receipt is ${Math.round(ageMin)} minutes old (policy limit ${rules.maximum_receipt_age_minutes})`);
      }
    }
  }
  if (rules.allow_experimental_sources === false && isExperimental(manifest)) {
    reasons.push('source is experimental (Scout-admitted, not human-approved)');
  }
  if (rules.minimum_consecutive_passes !== undefined && streak < rules.minimum_consecutive_passes) {
    reasons.push(`${streak} consecutive passes (policy requires ${rules.minimum_consecutive_passes})`);
  }
  if (rules.minimum_success_rate_30d !== undefined && stats.success_rate_30d !== null && stats.success_rate_30d !== undefined) {
    if (stats.success_rate_30d < rules.minimum_success_rate_30d) {
      reasons.push(`30d success rate ${stats.success_rate_30d} below policy minimum ${rules.minimum_success_rate_30d}`);
    }
  }
  const confidence = confidenceFor(receipt, stats);
  if (rules.minimum_confidence !== undefined && confidence < rules.minimum_confidence) {
    reasons.push(`confidence ${confidence} below policy minimum ${rules.minimum_confidence}`);
  }

  return { allowed: reasons.length === 0, reasons, confidence };
}
