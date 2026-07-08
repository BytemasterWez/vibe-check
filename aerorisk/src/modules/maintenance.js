// Module 2 — Maintenance risk fingerprint (FAA Service Difficulty Reports).
// The core rule from the product spec: ALWAYS separate tail-specific evidence
// from model-level evidence. A model-level SDR theme is a pre-buy inspection
// topic, never a defect claim against this specific aircraft.

import { daysAgo } from '../identity.js';

// JASC/ATA chapter prefixes we describe in plain English.
const JASC_CHAPTERS = {
  21: 'air conditioning/pressurisation',
  22: 'auto flight',
  24: 'electrical power',
  25: 'equipment/furnishings',
  27: 'flight controls',
  28: 'fuel system',
  32: 'landing gear',
  33: 'lights',
  34: 'navigation',
  52: 'doors',
  53: 'fuselage',
  55: 'stabilizers',
  57: 'wings',
  61: 'propeller',
  71: 'powerplant',
  72: 'engine',
  73: 'engine fuel and control',
  74: 'ignition',
  78: 'exhaust',
  79: 'engine oil',
  80: 'engine starting',
};

export function chapterOf(jascCode) {
  const prefix = String(jascCode ?? '').slice(0, 2);
  return JASC_CHAPTERS[prefix] ?? `JASC ${prefix}`;
}

function groupByChapter(sdrs) {
  const groups = new Map();
  for (const sdr of sdrs) {
    const chapter = chapterOf(sdr.JASC_CODE);
    if (!groups.has(chapter)) groups.set(chapter, []);
    groups.get(chapter).push(sdr);
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
}

export function assessMaintenance(store, { registry, now }) {
  const findings = [];
  const tailSdrs = store.sdrsForTail(registry.N_NUMBER);
  const modelSdrs = store.sdrsForModel(registry.MFR, registry.MODEL, registry.N_NUMBER);

  // Tail-specific and model-level scores are tracked separately: the spec
  // requires these never be conflated (a model theme is a pre-buy topic, not
  // a defect claim against this airframe).
  let tailScore = 0;
  let modelScore = 0;

  for (const sdr of tailSdrs) {
    const age = daysAgo(sdr.DATE, now);
    const recent = age !== null && age <= 3 * 365;
    tailScore += recent ? 20 : 10;
    findings.push({
      severity: recent ? 'priority' : 'review',
      text: `Tail-specific service difficulty report (${sdr.DATE}): ${sdr.PART_NAME} — ${sdr.NARRATIVE} [${chapterOf(sdr.JASC_CODE)}]`,
      evidence: [`FAA SDR ${sdr.REPORT_ID}`],
    });
  }

  const modelThemes = groupByChapter(modelSdrs).filter(([, list]) => list.length >= 2);
  for (const [chapter, list] of modelThemes.slice(0, 4)) {
    modelScore += Math.min(10, 3 + list.length * 2);
    findings.push({
      severity: 'review',
      text: `Model-level SDR theme for ${registry.MFR} ${registry.MODEL}: ${list.length} reports involving ${chapter}. This is fleet-wide context, not a defect claim against this aircraft — flag it for the pre-buy inspection.`,
      evidence: list.map((s) => `FAA SDR ${s.REPORT_ID} (${s.DATE})`),
    });
  }

  if (tailSdrs.length === 0 && modelSdrs.length === 0) {
    findings.push({
      severity: 'info',
      text: 'No SDR records matched this tail or model in the loaded dataset. Absence of reports is not proof of good maintenance — SDR filing is uneven across the GA fleet.',
      evidence: [],
    });
  } else if (tailSdrs.length === 0) {
    findings.push({
      severity: 'info',
      text: 'No tail-specific SDR match for this registration; findings above are model-level themes only.',
      evidence: [],
    });
  }

  return {
    key: 'maintenance',
    label: 'Maintenance signal',
    score: Math.min(100, tailScore + modelScore),
    confidence: tailSdrs.length + modelSdrs.length > 0 ? 'medium' : 'low',
    findings,
    narrative: buildNarrative(registry, tailSdrs, modelThemes),
    detail: {
      tailSdrCount: tailSdrs.length,
      modelSdrCount: modelSdrs.length,
      sdrTailScore: Math.min(100, tailScore),
      sdrModelScore: Math.min(100, modelScore),
      modelThemes: modelThemes.map(([chapter, list]) => ({ chapter, count: list.length })),
    },
  };
}

function buildNarrative(registry, tailSdrs, modelThemes) {
  const parts = [];
  if (tailSdrs.length > 0) {
    parts.push(
      `${tailSdrs.length} service difficulty report(s) reference this specific tail number — review each against the aircraft's logbooks.`,
    );
  } else {
    parts.push('No SDR directly references this tail number in the loaded records.');
  }
  if (modelThemes.length > 0) {
    const themes = modelThemes.map(([c, l]) => `${c} (${l.length})`).join(', ');
    parts.push(
      `The ${registry.MFR} ${registry.MODEL} fleet shows recurring SDR themes: ${themes}. Treat these as pre-buy inspection topics, not findings against this airframe.`,
    );
  }
  return parts.join(' ');
}
