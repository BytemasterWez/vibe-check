// Module 5 — Utilisation and activity profile.
// Works from historical flight records (licensed ADS-B exports or operator
// logs) loaded into flights.csv. Historical due diligence only — the product
// deliberately does no live tracking.

import { daysAgo, daysBetween } from '../identity.js';

export function assessUtilisation(store, { registry, now }) {
  const flights = store.flightsForTail(registry.N_NUMBER);
  const findings = [];
  let score = 0;

  if (flights.length === 0) {
    return {
      key: 'utilisation',
      label: 'Utilisation signal',
      score: 0,
      confidence: 'low',
      findings: [
        {
          severity: 'info',
          text: 'No flight-activity records loaded for this tail. Utilisation could not be profiled; request engine/airframe times and recent logbook entries from the seller instead.',
          evidence: [],
        },
      ],
      narrative: 'No activity data available for this aircraft in the loaded dataset.',
      detail: { flightCount: 0, homeAirport: null },
    };
  }

  const last = flights.at(-1);
  const recent90 = flights.filter((f) => within(f.DATE, 90, now));
  const recent365 = flights.filter((f) => within(f.DATE, 365, now));

  // Longest gap between consecutive flights over the record.
  let longestGap = 0;
  for (let i = 1; i < flights.length; i += 1) {
    const gap = daysBetween(flights[i - 1].DATE, flights[i].DATE) ?? 0;
    if (gap > longestGap) longestGap = gap;
  }

  if (longestGap >= 180) {
    score += 25;
    findings.push({
      severity: 'review',
      text: `Longest inactivity gap in the record is ${longestGap} days. Inactivity may be benign, but it raises storage, battery, corrosion, and maintenance-continuity questions.`,
      evidence: ['Flight-activity records (loaded dataset)'],
    });
  }

  const sinceLast = daysAgo(last.DATE, now) ?? 0;
  if (recent90.length <= 2 && sinceLast <= 90) {
    score += 10;
    findings.push({
      severity: 'review',
      text: `Lightly active over the past 90 days (${recent90.length} recorded flight(s)), with intermittent movement rather than regular use.`,
      evidence: ['Flight-activity records (loaded dataset)'],
    });
  }

  // Repositioning pattern: a one-way flight to a new airport after a long gap
  // is a classic pre-sale move worth asking about.
  const prev = flights.at(-2);
  if (prev) {
    const gapBeforeLast = daysBetween(prev.DATE, last.DATE) ?? 0;
    if (gapBeforeLast >= 120 && last.ORIGIN !== last.DEST) {
      score += 15;
      findings.push({
        severity: 'review',
        text: `Most recent movement (${last.DATE}, ${last.ORIGIN}→${last.DEST}) was a one-way repositioning after ${gapBeforeLast} days of inactivity — a common pre-sale pattern; ask where the aircraft was stored and why it moved.`,
        evidence: ['Flight-activity records (loaded dataset)'],
      });
    }
  }

  // Training-like pattern: high share of local flights (origin == destination).
  const local = flights.filter((f) => f.ORIGIN === f.DEST);
  const localShare = local.length / flights.length;
  if (flights.length >= 6 && localShare >= 0.6) {
    score += 15;
    findings.push({
      severity: 'review',
      text: `${Math.round(localShare * 100)}% of recorded flights are local (same origin and destination) — consistent with training use. Training utilisation means more landings/cycles per hour; weight the pre-buy toward landing gear, brakes, and engine-cycle wear.`,
      evidence: ['Flight-activity records (loaded dataset)'],
    });
  }

  // Short-hop stress: average leg under 45 minutes across a busy record.
  const avgMin = flights.reduce((s, f) => s + Number(f.DURATION_MIN || 0), 0) / flights.length;
  if (flights.length >= 6 && avgMin > 0 && avgMin < 45 && localShare < 0.6) {
    score += 10;
    findings.push({
      severity: 'review',
      text: `Average recorded leg is ${Math.round(avgMin)} minutes — a short-hop profile that accumulates cycles faster than hours.`,
      evidence: ['Flight-activity records (loaded dataset)'],
    });
  }

  const homeAirport = mostFrequentOrigin(flights);
  const home = store.airportRisk(homeAirport);
  if (home && /coastal/i.test(`${home.NOTES} ${home.COASTAL}`)) {
    score += 8;
    findings.push({
      severity: 'review',
      text: `Primary operating airport ${homeAirport} is a coastal/salt-air environment — add a corrosion inspection to the pre-buy.`,
      evidence: [`Airport risk table: ${homeAirport}`],
    });
  }

  return {
    key: 'utilisation',
    label: 'Utilisation signal',
    score: Math.min(100, score),
    confidence: flights.length >= 6 ? 'medium' : 'low',
    findings,
    narrative:
      `${flights.length} recorded flight(s); ${recent90.length} in the past 90 days, ${recent365.length} in the past year; ` +
      `last recorded movement ${last.DATE} (${sinceLast} days ago); primary airport ${homeAirport ?? 'unknown'}. ` +
      'Activity signals describe usage patterns, not condition — verify against logbooks.',
    detail: {
      flightCount: flights.length,
      recent90: recent90.length,
      recent365: recent365.length,
      longestGapDays: longestGap,
      homeAirport,
    },
  };
}

function within(dateIso, days, now) {
  const age = daysAgo(dateIso, now);
  return age !== null && age >= 0 && age <= days;
}

function mostFrequentOrigin(flights) {
  const counts = new Map();
  for (const f of flights) counts.set(f.ORIGIN, (counts.get(f.ORIGIN) ?? 0) + 1);
  let best = null;
  let bestCount = 0;
  for (const [ap, c] of counts) {
    if (c > bestCount) {
      best = ap;
      bestCount = c;
    }
  }
  return best;
}
