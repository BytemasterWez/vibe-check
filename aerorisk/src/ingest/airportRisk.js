// Shared airport_risk view builder. The runway-incursion and wildlife-strike
// adapters each own one column of the airport_risk view read by the airport
// context module. Rather than overwrite each other, each adapter merges its
// per-airport column into the existing production table (reading production is
// the same cross-source pattern the SDR/NTSB adapters use for the registry).

import { daysAgo } from '../identity.js';

export const AIRPORT_RISK_COLUMNS = [
  'AIRPORT', 'NAME', 'RUNWAY_INCURSIONS_5YR', 'WILDLIFE_STRIKES_5YR', 'COASTAL', 'NOTES',
];

// Count events per airport within the last `years` years of `now`.
export function countByAirportWithin(events, { airportKey, dateKey, years = 5, now }) {
  const counts = new Map();
  for (const e of events) {
    const code = (e[airportKey] ?? '').toUpperCase();
    if (!code) continue;
    const age = e[dateKey] ? daysAgo(e[dateKey], now) : null;
    // No/invalid date → count it (better to include than silently drop);
    // a valid date outside the window is excluded.
    if (age !== null && (age < 0 || age > years * 365)) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
}

// Merge a per-airport count into the existing airport_risk rows under `column`.
// existingRows: production airport_risk table (may be null/empty).
export function mergeAirportColumn(existingRows, counts, column) {
  const byCode = new Map((existingRows ?? []).map((r) => [r.AIRPORT.toUpperCase(), { ...r }]));
  for (const [code, count] of counts) {
    if (!byCode.has(code)) {
      byCode.set(code, {
        AIRPORT: code, NAME: '', RUNWAY_INCURSIONS_5YR: '', WILDLIFE_STRIKES_5YR: '',
        COASTAL: '', NOTES: '',
      });
    }
    byCode.get(code)[column] = String(count);
  }
  // Ensure every row carries all columns.
  return [...byCode.values()].map((r) => {
    const out = {};
    for (const c of AIRPORT_RISK_COLUMNS) out[c] = r[c] ?? '';
    return out;
  });
}
