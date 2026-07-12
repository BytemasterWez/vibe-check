// Module 3 — Accident and incident history (NTSB CAROL exports).
// Direct tail/serial matches carry real weight; same-model events are context
// for insurance and pre-buy discussion only and are labelled that way.

import { daysAgo } from '../identity.js';

const INJURY_WEIGHT = { fatal: 45, serious: 35, minor: 25, none: 18 };
const DAMAGE_WEIGHT = { destroyed: 15, substantial: 10, minor: 5, none: 0 };

function isTrue(v) {
  return /^(y|yes|true|1)$/i.test(String(v ?? '').trim());
}

// Human-readable injury counts when present (CAROL exposes onboard/onground).
function injurySummary(ev) {
  const onboard = Number.parseInt(ev.INJURY_ONBOARD, 10);
  const onground = Number.parseInt(ev.INJURY_ONGROUND, 10);
  const parts = [];
  if (Number.isInteger(onboard) && onboard > 0) parts.push(`${onboard} onboard`);
  if (Number.isInteger(onground) && onground > 0) parts.push(`${onground} on ground`);
  return parts.length ? `injuries: ${parts.join(', ')}` : '';
}

export function assessAccidents(store, { registry, now }) {
  const findings = [];
  const allDirect = store.ntsbForTail(registry.N_NUMBER, registry.SERIAL_NUMBER);

  // US tail numbers are recycled. The NTSB summary carries no serial, so a
  // tail-number match can belong to a PRIOR holder of the mark, not this
  // aircraft. Two signals identify that (an Anduril drone must not inherit a
  // Boeing 767's accident on the same recycled N-number):
  //   1. the event predates this airframe's manufacture year — an aircraft
  //      cannot have an accident before it existed (unambiguous); or
  //   2. the event's manufacturer clearly differs from the current aircraft's,
  //      which covers airframes with no manufacture year on file.
  // Excluded events are NOT dropped from the report — they surface as an info
  // finding — so due diligence never silently loses a real accident.
  const priorHolderEvents = [];
  const direct = [];
  for (const ev of allDirect) {
    const reason = priorHolderReason(ev, registry);
    if (reason) priorHolderEvents.push({ ev, reason });
    else direct.push(ev);
  }
  const modelEvents = store.ntsbForModel(registry.MFR, registry.MODEL, registry.N_NUMBER);

  // Direct (tail/serial) and same-model context scored separately, never
  // conflated — a model theme is discussion context, not this aircraft's record.
  let directScore = 0;
  let modelScore = 0;

  for (const ev of direct) {
    const injury = (ev.HIGHEST_INJURY ?? 'none').toLowerCase();
    const damage = (ev.DAMAGE ?? 'none').toLowerCase();
    let w = (INJURY_WEIGHT[injury] ?? 18) + (DAMAGE_WEIGHT[damage] ?? 0);
    // An "Accident" is, by NTSB definition, more serious than an "Incident".
    const isAccident = /accident/i.test(ev.EVENT_TYPE ?? '');
    if (isAccident) w += 8;
    // Safety recommendations mark a systemically significant event.
    if (isTrue(ev.HAS_SAFETY_REC)) w += 6;
    const age = daysAgo(ev.DATE, now);
    if (age !== null && age > 10 * 365) w = Math.round(w * 0.6);
    directScore += w;

    const finalReport = /final/i.test(ev.REPORT_TYPE ?? '');
    const injuries = injurySummary(ev);
    findings.push({
      severity: 'priority',
      text:
        `Direct NTSB ${ev.EVENT_TYPE || 'event'} — ${ev.DATE} at ${ev.CITY}, ${ev.STATE}` +
        ` (highest injury: ${ev.HIGHEST_INJURY || 'none'}${injuries ? `; ${injuries}` : ''}; ` +
        `${finalReport ? 'final report published' : `report status: ${ev.REPORT_TYPE || ev.STATUS || 'unknown'}`}` +
        `${isTrue(ev.HAS_SAFETY_REC) ? '; NTSB issued safety recommendation(s)' : ''}).` +
        (ev.PROBABLE_CAUSE
          ? ` Probable cause: ${ev.PROBABLE_CAUSE}`
          : ' Read the full NTSB report for probable cause and damage detail.'),
      evidence: [`NTSB ${ev.EVENT_ID}`, ...(ev.REPORT_URL ? [`Full report: ${ev.REPORT_URL}`] : [])],
    });
    if (!finalReport && (ev.STATUS ?? '').toLowerCase() !== 'completed') directScore += 10;
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

  for (const { ev, reason } of priorHolderEvents) {
    findings.push({
      severity: 'info',
      text: `NTSB event ${ev.DATE} on this tail number is excluded from the accident score — it appears to belong to a prior holder of the mark (${reason}). The current aircraft is a ${registry.YEAR_MFR || ''} ${registry.MFR} ${registry.MODEL}; the event aircraft was a ${ev.MFR || 'different'} ${ev.MODEL || ''}.`.replace(/\s+/g, ' ').trim(),
      evidence: [`NTSB ${ev.EVENT_ID} (${ev.DATE})`],
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

const MAKE_STOPWORDS = new Set([
  'INC', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LLC', 'AIRCRAFT',
  'AVIATION', 'INDUSTRIES', 'AEROSPACE', 'THE', 'AND', 'DESIGN', 'GROUP',
]);

function makeTokens(name) {
  return new Set(
    String(name ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !MAKE_STOPWORDS.has(t)),
  );
}

// Returns a short reason string if the event belongs to a prior holder of the
// recycled tail number, else null.
function priorHolderReason(ev, registry) {
  const mfrYear = Number.parseInt(registry.YEAR_MFR, 10);
  const evYear = Number.parseInt((ev.DATE ?? '').slice(0, 4), 10);
  if (Number.isInteger(mfrYear) && Number.isInteger(evYear) && evYear < mfrYear) {
    return `event predates the aircraft's ${mfrYear} manufacture`;
  }
  const evTokens = makeTokens(ev.MFR);
  const regTokens = makeTokens(registry.MFR);
  if (evTokens.size > 0 && regTokens.size > 0) {
    const shared = [...evTokens].some((t) => regTokens.has(t));
    if (!shared) return 'different manufacturer on the event record';
  }
  return null;
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
