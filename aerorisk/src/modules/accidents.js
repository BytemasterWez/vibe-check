// Module 3 — Accident and incident history (NTSB CAROL exports).
// Direct tail/serial matches carry real weight; same-model events are context
// for insurance and pre-buy discussion only and are labelled that way.

import { daysAgo } from '../identity.js';

const INJURY_WEIGHT = { fatal: 45, serious: 35, minor: 25, none: 18 };
const DAMAGE_WEIGHT = { destroyed: 15, substantial: 10, minor: 5, none: 0 };

export function assessAccidents(store, { registry, now }) {
  const findings = [];
  const direct = store.ntsbForTail(registry.N_NUMBER, registry.SERIAL_NUMBER);
  const modelEvents = store.ntsbForModel(registry.MFR, registry.MODEL, registry.N_NUMBER);

  // Direct (tail/serial) and same-model context scored separately, never
  // conflated — a model theme is discussion context, not this aircraft's record.
  let directScore = 0;
  let modelScore = 0;

  for (const ev of direct) {
    const injury = (ev.HIGHEST_INJURY ?? 'none').toLowerCase();
    const damage = (ev.DAMAGE ?? 'none').toLowerCase();
    let w = (INJURY_WEIGHT[injury] ?? 18) + (DAMAGE_WEIGHT[damage] ?? 0);
    const age = daysAgo(ev.DATE, now);
    if (age !== null && age > 10 * 365) w = Math.round(w * 0.6);
    directScore += w;

    const open = (ev.STATUS ?? '').toLowerCase() !== 'closed';
    findings.push({
      severity: 'priority',
      text:
        `Direct NTSB match: ${ev.DATE} event at ${ev.CITY}, ${ev.STATE}` +
        ` (highest injury: ${ev.HIGHEST_INJURY || 'none'}; damage: ${ev.DAMAGE || 'unknown'}; ${open ? 'investigation open' : 'closed'}).` +
        (ev.PROBABLE_CAUSE ? ` Probable cause: ${ev.PROBABLE_CAUSE}` : ' Probable cause not yet published.'),
      evidence: [`NTSB ${ev.EVENT_ID}`],
    });
    if (open) directScore += 10;
  }

  const themes = causeThemes(modelEvents);
  if (themes.length > 0) {
    modelScore += Math.min(12, themes.length * 4);
    findings.push({
      severity: 'review',
      text: `Same-model NTSB events (${modelEvents.length}) show recurring themes: ${themes.join('; ')}. Relevant for insurance and pre-buy discussion, not a defect claim against this aircraft.`,
      evidence: modelEvents.map((e) => `NTSB ${e.EVENT_ID} (${e.DATE})`),
    });
  }

  if (direct.length === 0) {
    findings.push({
      severity: 'info',
      text: 'No direct NTSB match found for this registration/serial combination in the loaded dataset.',
      evidence: [],
    });
  }

  return {
    key: 'accidents',
    label: 'Accident/incident signal',
    score: Math.min(100, directScore + modelScore),
    confidence: 'high',
    findings,
    narrative:
      direct.length > 0
        ? `${direct.length} NTSB event(s) directly reference this aircraft. Read the full docket(s) before any transaction.`
        : 'No direct NTSB accident/incident history for this aircraft in the loaded records; same-model context (if any) is noted for discussion only.',
    detail: {
      directCount: direct.length,
      modelEventCount: modelEvents.length,
      ntsbDirectEventScore: Math.min(100, directScore),
      ntsbModelContextScore: Math.min(100, modelScore),
    },
  };
}

const CAUSE_THEMES = [
  [/loss of (directional )?control.*landing|landing.*loss of control|ground ?loop/i, 'loss of control on landing'],
  [/gear (collapse|extension|retract)|landing gear/i, 'landing-gear events'],
  [/fuel (exhaustion|starvation|contamination)/i, 'fuel management'],
  [/engine (failure|power loss)|power ?loss/i, 'engine power loss'],
  [/carburetor|carb ice/i, 'carburetor icing'],
  [/weather|vfr into imc|instrument meteorological/i, 'weather decision-making'],
  [/stall|spin/i, 'aerodynamic stall'],
];

function causeThemes(events) {
  const found = new Set();
  for (const ev of events) {
    const text = `${ev.PROBABLE_CAUSE ?? ''}`;
    for (const [re, label] of CAUSE_THEMES) {
      if (re.test(text)) found.add(label);
    }
  }
  return [...found];
}
