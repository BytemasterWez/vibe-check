// Independent Carrier Risk Indicator + fraud/identity flags + decision.
//
// LABELLING RULE: nothing here is an "FMCSA score". FMCSA's SMS applies
// severity/time weights, exposure measures, data-sufficiency rules and peer
// percentiles that we do not reproduce. What we output is explicitly an
// "Independent Carrier Risk Indicator based on public FMCSA records" — our
// interpretation, kept separate from the official data it reads.

const NATIONAL_VEHICLE_OOS = 20; // approx FMCSA national roadside vehicle OOS %
const NATIONAL_DRIVER_OOS = 5; //  approx FMCSA national roadside driver OOS %

// Decision bands — the only sanctioned decision language.
export const DECISION = {
  LOWER: 'Lower observed concern',
  VERIFY: 'Manual verification required',
  ELEVATED: 'Elevated observed concern',
  STOP: 'Do not proceed until discrepancies are resolved',
};

function monthsSince(yyyymmdd, now) {
  const s = String(yyyymmdd ?? '');
  if (!/^\d{8}$/.test(s)) return null;
  const d = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`);
  return (now - d) / (1000 * 60 * 60 * 24 * 30.44);
}

export function assessCarrier(data, { now = new Date() } = {}) {
  const c = data.census;
  const flags = []; // { level: 'stop'|'elevated'|'verify'|'info', text }
  const notes = [];

  if (!c) {
    return {
      decision: DECISION.VERIFY,
      indicator: null,
      flags: [{ level: 'verify', text: `No FMCSA census record found for USDOT ${data.dot}. Confirm the number is correct before proceeding.` }],
      verdict: `No public FMCSA census record was found for USDOT ${data.dot}. That does not by itself mean the carrier is fraudulent, but nothing could be verified — treat every claim as unconfirmed until checked directly.`,
    };
  }

  const active = String(c.status_code).toUpperCase() === 'A';
  const powerUnits = Number.parseInt(c.power_units, 10) || 0;
  const drivers = Number.parseInt(c.total_drivers, 10) || 0;
  const recordAgeMonths = monthsSince(c.add_date, now);

  let concern = 8; // small baseline; most established carriers sit low

  // 1) Operating authority / status — the single biggest signal.
  if (!active) {
    concern += 60;
    flags.push({ level: 'stop', text: `Operating status is "${c.status_code}" (not Active) in the FMCSA census. A load must not be tendered against inactive authority — confirm current authority directly before any engagement.` });
  }

  // 2) New entrant — a core fraud/double-brokering signature.
  if (recordAgeMonths !== null && recordAgeMonths < 6) {
    concern += 25;
    flags.push({ level: 'elevated', text: `Carrier first appears in FMCSA records only ~${Math.round(recordAgeMonths)} month(s) ago. New authority is normal for legitimate new carriers but is also the most common fraud/double-brokering pattern — verify authority age, insurance and physical operation with extra care.` });
  } else if (recordAgeMonths !== null && recordAgeMonths < 12) {
    concern += 12;
    flags.push({ level: 'verify', text: `Carrier is relatively new to FMCSA records (~${Math.round(recordAgeMonths)} months). Apply standard new-carrier verification.` });
  }

  // 3) Equipment / driver plausibility.
  if (powerUnits === 0) {
    concern += 15;
    flags.push({ level: 'elevated', text: 'Census reports 0 power units. A carrier soliciting freight with no registered trucks is a red flag — confirm the equipment that would actually haul the load.' });
  } else if (drivers > 0 && (drivers / powerUnits > 4 || powerUnits / Math.max(drivers, 1) > 4)) {
    concern += 8;
    flags.push({ level: 'verify', text: `Unusual ratio of ${drivers} drivers to ${powerUnits} power units. Not necessarily a problem, but worth a question.` });
  }

  // 4) Safety evidence (roadside OOS vs national averages) — only meaningful
  //    when there is enough inspection data.
  const insp = data.inspections;
  if (insp.last24mo < 3) {
    concern += 6;
    flags.push({ level: 'verify', text: `Only ${insp.last24mo} roadside inspection(s) in the last 24 months — too little data to judge the safety record. Absence of inspections is not a clean record; verify the carrier is genuinely operating.` });
  } else {
    if (insp.vehicleOosRatePct != null && insp.vehicleOosRatePct > NATIONAL_VEHICLE_OOS + 8) {
      concern += 12;
      flags.push({ level: 'elevated', text: `Vehicle out-of-service rate ${insp.vehicleOosRatePct}% over the last 24 months is well above the ~${NATIONAL_VEHICLE_OOS}% national roadside average — a maintenance concern.` });
    }
    if (insp.driverOosRatePct != null && insp.driverOosRatePct > NATIONAL_DRIVER_OOS + 4) {
      concern += 10;
      flags.push({ level: 'elevated', text: `Driver out-of-service rate ${insp.driverOosRatePct}% over the last 24 months is above the ~${NATIONAL_DRIVER_OOS}% national roadside average.` });
    }
  }

  // 5) Recent crash frequency relative to fleet (rolling 24-month, not lifetime).
  const cr = data.crashes;
  if (powerUnits > 0 && cr.last24mo > 0) {
    const per100 = (cr.last24mo / powerUnits) * 100;
    if (per100 > 40) {
      concern += 10;
      flags.push({ level: 'elevated', text: `${cr.last24mo} crashes in the last 24 months against ${powerUnits} power units (${per100.toFixed(0)} per 100 trucks) is an elevated recent crash frequency.` });
    }
  }

  const indicator = Math.max(0, Math.min(100, Math.round(concern)));
  const decision = decideFrom(indicator, active, insp.last24mo);

  return {
    decision,
    indicator,
    flags,
    notes,
    verdict: buildVerdict(c, data, decision, flags),
  };
}

function decideFrom(indicator, active, inspCount) {
  if (!active || indicator >= 70) return DECISION.STOP;
  if (indicator >= 40) return DECISION.ELEVATED;
  if (indicator >= 18 || inspCount < 3) return DECISION.VERIFY;
  return DECISION.LOWER;
}

function buildVerdict(c, data, decision, flags) {
  const name = c.legal_name || `USDOT ${data.dot}`;
  const stop = flags.find((f) => f.level === 'stop');
  const elevated = flags.filter((f) => f.level === 'elevated');
  const lead =
    decision === DECISION.STOP
      ? `${name} shows a stop-and-resolve condition in the public FMCSA record.`
      : decision === DECISION.ELEVATED
        ? `${name} shows elevated concern in the public FMCSA record.`
        : decision === DECISION.VERIFY
          ? `${name} needs manual verification before you rely on it.`
          : `${name} shows lower observed concern in the public FMCSA record.`;
  const detail = stop
    ? ` The decisive issue: ${stop.text.split('.')[0].toLowerCase()}.`
    : elevated.length
      ? ` Key points: ${elevated.map((f) => f.text.split('.')[0].toLowerCase()).slice(0, 2).join('; ')}.`
      : ' Nothing in the public record stands out, but public data cannot confirm who is emailing or calling you.';
  return `${lead}${detail} This is decision support from public records, not a guarantee — complete the verification checklist before tendering a load.`;
}
