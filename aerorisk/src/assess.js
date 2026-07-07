// Pipeline orchestrator: N-number in → structured assessment out.
// The assessment object is the single source of truth; the report renderer
// and the JSON output are both views of it.

import { resolveIdentity } from './identity.js';
import { assessRegistration } from './modules/registration.js';
import { assessMaintenance } from './modules/maintenance.js';
import { assessAccidents } from './modules/accidents.js';
import { assessAdExposure } from './modules/adExposure.js';
import { assessUtilisation } from './modules/utilisation.js';
import { assessEnforcement } from './modules/enforcement.js';
import { assessHumanFactors } from './modules/humanFactors.js';
import { assessAirportContext } from './modules/airportContext.js';
import { compositeScore, bandFor, reviewPriorityLanguage, reportConfidence } from './scoring.js';

const SEVERITY_RANK = { priority: 0, review: 1, info: 2 };

export function assessAircraft(store, rawNNumber, { now = new Date() } = {}) {
  const identity = resolveIdentity(store, rawNNumber);
  if (!identity.registry) {
    return { identity, modules: [], score: null, band: null, findings: [], generatedAt: now.toISOString() };
  }

  const registry = identity.registry;
  const ctx = { identity, registry, now };

  // Utilisation runs first so its airport set feeds the context modules.
  const utilisation = assessUtilisation(store, ctx);
  const airports = [...new Set(store.flightsForTail(registry.N_NUMBER).flatMap((f) => [f.ORIGIN, f.DEST]))];

  const modules = [
    assessRegistration(store, ctx),
    assessMaintenance(store, ctx),
    assessAccidents(store, ctx),
    assessAdExposure(store, ctx),
    utilisation,
    assessEnforcement(store, ctx),
    assessHumanFactors(store, { ...ctx, airports }),
    assessAirportContext(store, { ...ctx, airports }),
  ];

  const score = compositeScore(modules);
  const findings = modules
    .flatMap((m) => m.findings.map((f) => ({ ...f, module: m.label })))
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));

  return {
    identity,
    registry,
    modules,
    airports,
    score,
    band: bandFor(score),
    summaryLanguage: reviewPriorityLanguage(score),
    reportConfidence: reportConfidence(identity, modules),
    findings,
    topFindings: findings.filter((f) => f.severity !== 'info').slice(0, 5),
    generatedAt: now.toISOString(),
  };
}
