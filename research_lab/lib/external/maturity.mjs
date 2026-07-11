// External-evidence maturity ladder (Packet 3 §8).
//
// C5 conceals an important difference: "software evidence exhausted across
// simulated worlds" is NOT "replicated on data we did not generate". The
// external track makes that explicit and — crucially — the autonomous loop can
// never self-advance into it. Every external/hardware/human level requires
// human-gated provenance, so the loop can only PREPARE evidence and escalate.

export const EXTERNAL_LADDER = [
  { level: 'C5-SIMULATED', desc: 'software ceiling reached across independent simulated worlds', autonomous: true },
  { level: 'E1-EXTERNAL-REPLAY', desc: 'estimator executed on eligible external recordings', autonomous: false, escalation: 'NEEDS_EXTERNAL_DATASET' },
  { level: 'E2-EXTERNAL-REPRODUCED', desc: 'external results reproduced exactly by an independent run', autonomous: false, escalation: 'NEEDS_EXTERNAL_DATASET' },
  { level: 'E3-CROSS-DATASET', desc: 'passed across two independently acquired datasets', autonomous: false, escalation: 'NEEDS_EXTERNAL_DATASET' },
  { level: 'H1-BENCH-HARDWARE', desc: 'passed a controlled hardware phantom / mechanical target', autonomous: false, escalation: 'NEEDS_HARDWARE' },
  { level: 'H2-HUMAN-FEASIBILITY', desc: 'passed approved non-diagnostic human feasibility collection', autonomous: false, escalation: 'NEEDS_HUMAN_LABELS' },
];

const INDEX = Object.fromEntries(EXTERNAL_LADDER.map((l, i) => [l.level, i]));

export function describeExternal(level) {
  return EXTERNAL_LADDER[INDEX[level]];
}

export function requiresHumanGate(level) {
  const l = describeExternal(level);
  return l ? !l.autonomous : true;
}

// Gate an external advancement. The autonomous loop is never permitted to cross
// into the external track; it must escalate. Even a human-driven advance to
// E3 requires >= 2 independently acquired datasets (one small dataset must not
// cause a major maturity jump).
export function externalAdvanceGate({ to, autonomous = true, datasets = [], reproduced = false }) {
  const target = describeExternal(to);
  if (!target) return { allowed: false, escalate: null, reasons: [`unknown external level: ${to}`] };

  if (autonomous && !target.autonomous) {
    return { allowed: false, escalate: target.escalation, reasons: [`${to} requires human-gated provenance; the autonomous loop must escalate ${target.escalation}`] };
  }

  const reasons = [];
  const distinctSources = new Set(datasets.map((d) => d.source)).size;
  if (to === 'E1-EXTERNAL-REPLAY' && datasets.length < 1) reasons.push('no eligible external dataset replayed');
  if (to === 'E2-EXTERNAL-REPRODUCED' && !reproduced) reasons.push('external result not reproduced exactly');
  if (to === 'E3-CROSS-DATASET' && distinctSources < 2) reasons.push('cross-dataset requires >= 2 independently acquired datasets');

  return { allowed: reasons.length === 0, escalate: null, reasons };
}
