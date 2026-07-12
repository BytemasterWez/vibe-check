// Renders the carrier due-diligence report as self-contained HTML.
// Structure follows the agreed spec: Identity / Authority & Insurance / Safety
// evidence / Fraud & identity warning signs / Decision / Verification checklist.
// It is decision support from public records, explicitly NOT a guarantee.

import { DECISION } from './assess.mjs';

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const DECISION_CLASS = {
  [DECISION.LOWER]: 'lower',
  [DECISION.VERIFY]: 'verify',
  [DECISION.ELEVATED]: 'elevated',
  [DECISION.STOP]: 'stop',
};
const FLAG_CLASS = { stop: 'stop', elevated: 'elevated', verify: 'verify', info: 'info' };

const VERIFICATION_CHECKLIST = [
  'Call a phone number obtained independently from a trusted source — never only the number on the offering email.',
  'Verify the email domain matches the carrier’s established domain; be wary of free/lookalike domains.',
  'Confirm active insurance directly with the insurer or via FMCSA L&I, including coverage amount and effective dates.',
  'Confirm operating authority is active as of today (status changes daily).',
  'Compare bank/remittance details against previously verified records; treat any change as a fraud signal.',
  'Verify the specific truck, driver and dispatch details for this load.',
  'Escalate any urgency, discounting, or pressure to skip steps — these are hallmarks of double-brokering fraud.',
];

const STYLE = `
:root{--ink:#17202e;--muted:#5b6675;--line:#e3e7ee;--accent:#123a5f}
*{box-sizing:border-box}body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:#f4f6f9;margin:0;line-height:1.5}
.sheet{max-width:840px;margin:24px auto;background:#fff;padding:38px 46px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
h1{font-size:21px;margin:0 0 2px;color:var(--accent)}h2{font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:var(--accent);border-bottom:2px solid var(--line);padding-bottom:6px;margin:26px 0 12px}
.sub{color:var(--muted);font-size:13px;margin:0 0 18px}
.decision{display:flex;align-items:center;gap:14px;margin:14px 0}
.pill{padding:6px 14px;border-radius:999px;font-weight:700;font-size:14px}
.pill.lower{background:#e6f4ea;color:#1e7a3d}.pill.verify{background:#fef6e0;color:#8a6d1a}
.pill.elevated{background:#fde4d3;color:#9a4a12}.pill.stop{background:#f8d7da;color:#842029}
.ind{font-size:13px;color:var(--muted)}
.verdict{font-size:15px;background:#f7f9fc;border-left:4px solid var(--accent);padding:14px 16px;border-radius:4px;margin:12px 0}
table{width:100%;border-collapse:collapse;font-size:13px;margin:6px 0}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;width:36%}
.flag{margin:8px 0;padding:9px 12px;border-left:4px solid var(--line);font-size:13px;background:#fbfcfe}
.flag.stop{border-left-color:#a3311f;background:#fdf3f2}.flag.elevated{border-left-color:#c26a1c}.flag.verify{border-left-color:#b79521}.flag.info{border-left-color:#9aa4b2}
.flag .lv{font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;color:var(--muted)}
.chk li{font-size:13px;margin:6px 0}
.note{font-size:12px;color:var(--muted);margin:4px 0}
.disclaimer{font-size:11px;color:var(--muted);border-top:1px solid var(--line);margin-top:26px;padding-top:12px}
@media print{body{background:#fff}.sheet{box-shadow:none;margin:0;max-width:none;padding:0 12mm}h2{page-break-after:avoid}.flag{page-break-inside:avoid}}
`;

function row(k, v) {
  return `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;
}

export function renderCarrierReport(data, assessment, { now = new Date() } = {}) {
  const c = data.census ?? {};
  const cr = data.crashes;
  const insp = data.inspections;
  const decisionClass = DECISION_CLASS[assessment.decision] ?? 'verify';

  const identity = c.legal_name
    ? `<table>
        ${row('Legal name', c.legal_name)}
        ${row('DBA name', c.dba_name || '—')}
        ${row('USDOT #', data.dot)}
        ${row('MC/Docket', `${c.docket1prefix || ''}${c.docket1 || '—'}`)}
        ${row('Operating status', `${c.status_code === 'A' ? 'Active' : c.status_code} (census)`)}
        ${row('Carrier operation', c.carrier_operation || '—')}
        ${row('Power units', c.power_units || '—')}
        ${row('Drivers', c.total_drivers || '—')}
        ${row('Hazmat', c.hm_ind === 'Y' ? 'Yes' : 'No')}
        ${row('Physical location', [c.phy_city, c.phy_state].filter(Boolean).join(', ') || '—')}
        ${row('First in FMCSA records', c.add_date ? fmt(c.add_date) : '—')}
        ${row('Census last updated', c.mcs150_date ? fmt(c.mcs150_date) : '—')}
       </table>`
    : `<p class="note">No FMCSA census record found for USDOT ${esc(data.dot)}.</p>`;

  const safety = c.legal_name
    ? `
    <p class="note"><strong>Crashes</strong> are lifetime FMCSA records; the rolling 24-month figure is what reflects current risk. <strong>Inspections</strong> come from a shorter file window, stated below.</p>
    <table>
      ${row('Crashes — lifetime (distinct events)', `${cr.lifetimeDistinct.toLocaleString()} (${cr.firstDate || '?'} to ${cr.lastDate || '?'})`)}
      ${row('Crashes — last 24 months', `${cr.last24mo} (fatal: ${cr.last24Fatal}, injuries: ${cr.last24Injuries}, tow-away: ${cr.last24TowAway})`)}
      ${row('Inspection file window', `${insp.fileWindowStart || '?'} to ${insp.fileWindowEnd || '?'} (${insp.fileTotal.toLocaleString()} inspections)`)}
      ${row('Inspections — last 24 months', insp.last24mo.toLocaleString())}
      ${row('Vehicle out-of-service rate (24 mo)', insp.vehicleOosRatePct != null ? `${insp.vehicleOosRatePct}% (national roadside avg ≈ 20%)` : 'insufficient data')}
      ${row('Driver out-of-service rate (24 mo)', insp.driverOosRatePct != null ? `${insp.driverOosRatePct}% (national roadside avg ≈ 5%)` : 'insufficient data')}
    </table>`
    : '';

  const flagsHtml = assessment.flags.length
    ? assessment.flags.map((f) => `<div class="flag ${FLAG_CLASS[f.level] || 'info'}"><span class="lv">${esc(f.level)}</span> ${esc(f.text)}</div>`).join('')
    : '<p class="note">No specific fraud or identity warning signs surfaced in the public record. This is not confirmation of legitimacy — see the verification checklist.</p>';

  const body = `
    <h1>Carrier Due-Diligence Report</h1>
    <p class="sub">${esc(c.legal_name || `USDOT ${data.dot}`)} · USDOT ${esc(data.dot)} · generated ${esc(now.toISOString().slice(0, 10))}</p>

    <div class="decision">
      <span class="pill ${decisionClass}">${esc(assessment.decision)}</span>
      ${assessment.indicator != null ? `<span class="ind">Independent Carrier Risk Indicator: ${assessment.indicator}/100 — our calculation from public FMCSA records, <em>not</em> an official FMCSA/SMS score</span>` : ''}
    </div>
    <div class="verdict">${esc(assessment.verdict)}</div>

    <h2>1 · Identity</h2>
    ${identity}

    <h2>2 · Authority &amp; insurance</h2>
    <table>
      ${row('Operating authority (census status)', c.status_code === 'A' ? 'Active' : (c.status_code || 'unknown'))}
      ${row('Insurance on file', 'Not in the public dataset — confirm directly (see checklist)')}
    </table>
    <p class="note">Authority status changes daily and insurance is not in the bulk public data. Both must be confirmed directly at booking time — see the verification checklist.</p>

    <h2>3 · Safety evidence</h2>
    ${safety}

    <h2>4 · Fraud &amp; identity warning signs</h2>
    ${flagsHtml}

    <h2>5 · Decision</h2>
    <p><strong>${esc(assessment.decision)}.</strong> ${esc(assessment.verdict)}</p>

    <h2>6 · Verification checklist (do before tendering a load)</h2>
    <p class="note">Public data cannot prove the person contacting you genuinely represents this carrier — fraudsters impersonate real, clean carriers. This report is decision support, not a guarantee.</p>
    <ul class="chk">${VERIFICATION_CHECKLIST.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>

    <div class="disclaimer">This report summarises publicly available FMCSA records (motor carrier census, crash file, inspection file) as of the generation date. It is decision-support only, not a guarantee of a carrier's legitimacy, safety, or current authority, and it does not confirm the identity of any person contacting you. The Independent Carrier Risk Indicator is our own calculation from public records and is not an FMCSA Safety Measurement System score or percentile. Verify all material facts directly before acting.</div>
  `;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Carrier Report — USDOT ${esc(data.dot)}</title><style>${STYLE}</style></head><body><div class="sheet">${body}</div></body></html>`;
}

function fmt(yyyymmdd) {
  const s = String(yyyymmdd ?? '').slice(0, 10);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s.includes('T') ? s.slice(0, 10) : s;
}
