// Governor — enforces budgets, safety rules and the maturity ceiling.
//
// It CANNOT approve expenditure or clinical claims (blueprint role table). It is
// a gate: given a proposed action it returns { allowed, reasons }. Every
// maturity advance and every execution passes through it. The governor also
// owns the list of conditions that must halt the loop and escalate to a human.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isAtOrBelowCeiling, levelIndex, PRE_HARDWARE_CEILING } from './maturity.mjs';
import { evaluateHardConstraints, DEFAULT_CONSTRAINTS } from './constraints.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_POLICY = path.join(HERE, '..', 'policy', 'autonomy.json');

export function loadPolicy(policyPath = DEFAULT_POLICY) {
  return JSON.parse(fs.readFileSync(policyPath, 'utf-8'));
}

// Actions the loop can propose. Anything flagged "forbidden" in policy is a hard
// stop that escalates rather than proceeds.
const FORBIDDEN_ACTION_KEYS = {
  purchase_hardware: 'hardware_purchase',
  use_paid_api: 'paid_api_use',
  contact_person: 'contact_people',
  recruit_participant: 'recruit_participants',
  diagnose_patient: 'diagnose_real_patient',
  promote_clinical_claim: 'promote_clinical_claim',
  alter_frozen_threshold: 'alter_frozen_thresholds',
  delete_failed_result: 'delete_failed_results',
  use_private_health_data: 'use_private_health_data',
};

export function createGovernor(policy = loadPolicy()) {
  const consecutiveFailures = { count: 0 };
  const counters = { protocol_tamper_events: 0, unsupported_promotion_attempts: 0 };

  function checkAction(action) {
    const policyKey = FORBIDDEN_ACTION_KEYS[action];
    if (policyKey && policy.autonomy[policyKey] === 'forbidden') {
      return { allowed: false, escalate: true, reasons: [`autonomy boundary: ${action} is forbidden`] };
    }
    return { allowed: true, escalate: false, reasons: [] };
  }

  // Gate an experiment before it runs: budget + boundary checks.
  function checkExecution(experiment, env = {}) {
    const reasons = [];
    const maxMin = policy.resources.maximum_runtime_per_experiment_minutes;
    if ((experiment.estimated_runtime_minutes ?? 0) > maxMin) {
      reasons.push(`estimated runtime exceeds ${maxMin} min budget`);
    }
    if (env.free_disk_gb !== undefined && env.free_disk_gb < policy.resources.minimum_free_disk_gb) {
      reasons.push(`free disk ${env.free_disk_gb}GB below ${policy.resources.minimum_free_disk_gb}GB floor`);
    }
    if (policy.resources.run_only_while_connected_to_power && env.on_power === false) {
      reasons.push('policy requires mains power; running on battery');
    }
    return { allowed: reasons.length === 0, reasons };
  }

  // Gate a maturity advance: never past the pre-hardware ceiling. An attempt to
  // cross the ceiling is recorded as an unsupported-promotion attempt, which is
  // itself a hard-constraint violation the next advancement will see.
  function checkAdvance(fromLevel, toLevel) {
    if (!isAtOrBelowCeiling(toLevel)) {
      counters.unsupported_promotion_attempts += 1;
      return {
        allowed: false,
        escalate: true,
        reasons: [`${toLevel} is above the pre-hardware ceiling ${PRE_HARDWARE_CEILING}; requires hardware/human governance`],
      };
    }
    if (levelIndex(toLevel) <= levelIndex(fromLevel)) {
      return { allowed: false, escalate: false, reasons: ['advance is not upward'] };
    }
    return { allowed: true, escalate: false, reasons: [] };
  }

  function recordTamper() {
    counters.protocol_tamper_events += 1;
  }

  // Two-stage advancement gate: hard safety constraints FIRST (a high utility can
  // never buy back a dangerous confident-error class), then the caller ranks by
  // utility. `context` supplies the aggregate evidence; the governor injects its
  // own tamper / unsupported-promotion counters so they cannot be spoofed.
  function checkHardConstraints(context) {
    return evaluateHardConstraints(
      {
        ...context,
        protocol_tamper_events: counters.protocol_tamper_events,
        unsupported_promotion_attempts: counters.unsupported_promotion_attempts,
      },
      DEFAULT_CONSTRAINTS
    );
  }

  function recordResult(passed) {
    if (passed) consecutiveFailures.count = 0;
    else consecutiveFailures.count += 1;
  }

  function shouldHaltForFailures() {
    const max = policy.resources.maximum_consecutive_failures;
    return consecutiveFailures.count >= max
      ? { halt: true, reason: `reached ${max} consecutive failing experiments without information gain` }
      : { halt: false };
  }

  return {
    policy,
    checkAction,
    checkExecution,
    checkAdvance,
    checkHardConstraints,
    recordTamper,
    recordResult,
    shouldHaltForFailures,
    get counters() {
      return { ...counters };
    },
    get consecutiveFailures() {
      return consecutiveFailures.count;
    },
  };
}

// The terminal conditions from the blueprint (§ "The system continues until").
export const TERMINAL_CONDITIONS = [
  'all_testable_claims_resolved',
  'pre_hardware_ceiling_reached',
  'fatal_contradiction_found',
  'independent_data_exhausted',
  'resource_limit_reached',
  'decision_required',
];
