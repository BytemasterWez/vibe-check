// FMCSA public-data fetch + rigorous aggregation for a single carrier.
//
// Data-integrity rules learned from auditing the live datasets — every one of
// these matters for an honest report:
//   * Crash file (aayw-vxb3) is LIFETIME (events back to 1989). Always report
//     the rolling 24-month figure alongside the lifetime total, never the
//     lifetime total alone.
//   * Inspection file (fx4q-ay7w) is a ~3-year rolling window, a different
//     grain from crashes — state the actual window.
//   * Numeric-looking fields (viol_total, oos_total, fatalities, ...) are
//     stored as STRINGS; parse before arithmetic or sums silently vanish.
//   * distinct crash_id / inspection_id == row count in these sets (verified),
//     but we still count distinct so a future dup can't inflate the number.

const HOST = 'https://data.transportation.gov/resource';
const CENSUS = 'az4n-8mr2';
const CRASH = 'aayw-vxb3';
const INSPECTION = 'fx4q-ay7w';

async function soda(dataset, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${HOST}/${dataset}.json?${qs}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`FMCSA ${dataset} HTTP ${res.status}`);
  return res.json();
}

const num = (v) => {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : 0;
};

// YYYYMMDD string for `months` before now.
function cutoff(months, now = new Date()) {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

export async function fetchCarrier(dot, { now = new Date() } = {}) {
  const dotStr = String(dot).replace(/\D/g, '');
  const cut24 = cutoff(24, now);

  const censusRows = await soda(CENSUS, { dot_number: dotStr, $limit: 1 });
  const census = censusRows[0] ?? null;

  // Crashes: lifetime aggregate + rolling-24mo detail (parsed in JS).
  const [crashAgg] = await soda(CRASH, {
    $select: 'count(1) as total, count(distinct crash_id) as distinct_id, min(report_date) as first, max(report_date) as last',
    dot_number: dotStr,
  });
  const crash24 = await soda(CRASH, {
    $select: 'crash_id,report_date,fatalities,injuries,tow_away',
    dot_number: dotStr,
    $where: `report_date>='${cut24}'`,
    $limit: 50000,
  });

  // Inspections: window-wide aggregate is unsafe (string sums), so pull the
  // 24-month rows and compute rates in JS.
  const [inspAgg] = await soda(INSPECTION, {
    $select: 'count(1) as total, min(insp_date) as first, max(insp_date) as last',
    dot_number: dotStr,
  });
  const insp24 = await soda(INSPECTION, {
    $select: 'inspection_id,insp_date,viol_total,oos_total,vehicle_oos_total,driver_oos_total,hazmat_oos_total',
    dot_number: dotStr,
    $where: `insp_date>='${cut24}'`,
    $limit: 50000,
  });

  return {
    dot: dotStr,
    fetchedAt: now.toISOString(),
    window24Start: cut24,
    census,
    crashes: summariseCrashes(crashAgg, crash24),
    inspections: summariseInspections(inspAgg, insp24),
  };
}

function fmtDate(yyyymmdd) {
  const s = String(yyyymmdd ?? '');
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '';
}

function summariseCrashes(agg, recent) {
  const fatal = recent.reduce((s, r) => s + num(r.fatalities), 0);
  const injuries = recent.reduce((s, r) => s + num(r.injuries), 0);
  const tow = recent.filter((r) => /^y|1|t/i.test(String(r.tow_away))).length;
  return {
    lifetimeTotal: num(agg?.total),
    lifetimeDistinct: num(agg?.distinct_id),
    firstDate: fmtDate(agg?.first),
    lastDate: fmtDate(agg?.last),
    last24mo: recent.length,
    last24Fatal: fatal,
    last24Injuries: injuries,
    last24TowAway: tow,
  };
}

function summariseInspections(agg, recent) {
  const total24 = recent.length;
  const vehOos = recent.filter((r) => num(r.vehicle_oos_total) > 0).length;
  const drvOos = recent.filter((r) => num(r.driver_oos_total) > 0).length;
  const anyViol = recent.filter((r) => num(r.viol_total) > 0).length;
  const rate = (n) => (total24 > 0 ? Math.round((n / total24) * 1000) / 10 : null);
  return {
    fileWindowStart: fmtDate(agg?.first),
    fileWindowEnd: fmtDate(agg?.last),
    fileTotal: num(agg?.total),
    last24mo: total24,
    last24VehicleOos: vehOos,
    last24DriverOos: drvOos,
    last24WithViolation: anyViol,
    vehicleOosRatePct: rate(vehOos), // FMCSA national avg vehicle OOS ~ 20%
    driverOosRatePct: rate(drvOos), //  FMCSA national avg driver OOS ~ 5%
  };
}
