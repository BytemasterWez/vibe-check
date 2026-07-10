// The fixed maturity ladder (blueprint §3).
//
// The autonomous pre-hardware system is PERMANENTLY forbidden from advancing
// anything past C5. Everything above C5 requires physical apparatus, benches,
// or human subjects — none of which this software loop may touch.

export const LADDER = [
  { level: 'C0', name: 'Proposed', desc: 'an idea only' },
  { level: 'C1', name: 'Physically plausible', desc: 'causal pathway defined' },
  { level: 'C2', name: 'External evidence', desc: 'independent literature supports feasibility' },
  { level: 'C3', name: 'Independent-data reproduction', desc: 'algorithm works on data we did not generate' },
  { level: 'C4', name: 'Adversarial simulation', desc: 'survives confounders and abstains correctly' },
  { level: 'C5', name: 'Hardware experiment required', desc: 'software-only evidence ceiling reached' },
  { level: 'C6', name: 'Bench validated', desc: 'physical apparatus agrees with references' },
  { level: 'C7', name: 'Human observational validation', desc: 'representative subjects, approved protocol' },
  { level: 'C8', name: 'Clinical performance established', desc: 'prospective clinical validation' },
];

// The hard ceiling for autonomous, pre-hardware operation.
export const PRE_HARDWARE_CEILING = 'C5';

const ORDER = LADDER.map((l) => l.level);

export function levelIndex(level) {
  const i = ORDER.indexOf(level);
  if (i < 0) throw new Error(`unknown maturity level: ${level}`);
  return i;
}

export function isAtOrBelowCeiling(level) {
  return levelIndex(level) <= levelIndex(PRE_HARDWARE_CEILING);
}

export function nextLevel(level) {
  const i = levelIndex(level);
  return i + 1 < ORDER.length ? ORDER[i + 1] : level;
}

export function describe(level) {
  return LADDER[levelIndex(level)];
}

// Which experiment family provides evidence for advancing INTO a given level.
// C2->C3 needs independent-data reproduction (Family A/B on data we did not
// author); C3->C4 needs adversarial survival (Family C). This is the only place
// that maps evidence type to a maturity step.
export function familyForAdvanceTo(level) {
  switch (level) {
    case 'C3':
      return 'independent_data';
    case 'C4':
      return 'adversarial';
    case 'C5':
      return 'hardware_gate'; // reached by exhausting software-testable questions
    default:
      return null;
  }
}
