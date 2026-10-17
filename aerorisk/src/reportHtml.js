// Self-contained, print-optimised HTML rendering of the Aircraft Due-Diligence
// Pack — the forwardable deliverable. No external assets (styles inlined) so it
// opens anywhere and "Save as PDF" from any browser produces the PDF. The
// content mirrors the markdown report; this is a presentation layer only.

import { DISCLAIMER, buyerChecklist } from './report.js';

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Turn bare URLs in evidence into links; escape everything else.
function linkify(text) {
  const escaped = esc(text);
  return escaped.replace(/(https?:\/\/[^\s;]+)/g, '<a href="$1">$1</a>');
}

const BAND_CLASS = {
  'Low public risk signal': 'low',
  'Some review points': 'some',
  'Material due-diligence questions': 'material',
  'High review priority': 'high',
  'Serious public-risk concentration; manual expert review recommended': 'serious',
};

const STYLE = `
:root { --ink:#1a2230; --muted:#5b6675; --line:#e2e6ec; --bg:#fff; --accent:#12395f; }
* { box-sizing:border-box; }
body { font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; color:var(--ink); background:#f4f6f9; margin:0; line-height:1.5; }
.sheet { max-width:820px; margin:24px auto; background:var(--bg); padding:40px 48px; box-shadow:0 1px 4px rgba(0,0,0,.08); }
h1 { font-size:22px; margin:0 0 4px; color:var(--accent); }
h2 { font-size:15px; text-transform:uppercase; letter-spacing:.04em; color:var(--accent); border-bottom:2px solid var(--line); padding-bottom:6px; margin:28px 0 12px; }
.sub { color:var(--muted); font-size:13px; margin:0 0 20px; }
.verdict { font-size:16px; line-height:1.55; background:#f7f9fc; border-left:4px solid var(--accent); padding:16px 18px; border-radius:4px; margin:16px 0; }
.scorebar { display:flex; align-items:center; gap:14px; margin:16px 0; }
.score { font-size:34px; font-weight:700; }
.band { padding:4px 12px; border-radius:999px; font-size:13px; font-weight:600; }
.band.low{background:#e6f4ea;color:#1e7a3d} .band.some{background:#fef6e0;color:#8a6d1a}
.band.material{background:#fdefe0;color:#9a5a1a} .band.high{background:#fde4e1;color:#a3311f}
.band.serious{background:#f8d7da;color:#842029}
table { width:100%; border-collapse:collapse; font-size:13px; margin:8px 0 4px; }
th,td { text-align:left; padding:7px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--muted); font-weight:600; }
.finding { margin:10px 0; padding-left:12px; border-left:3px solid var(--line); font-size:13px; }
.finding.priority { border-left-color:#a3311f; }
.finding.review { border-left-color:#8a6d1a; }
.finding .sev { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); font-weight:600; }
.finding .ev { color:var(--muted); font-size:12px; margin-top:2px; }
.finding .ev a { color:var(--accent); }
.narr { font-size:13px; color:var(--muted); margin:4px 0 10px; }
.disclaimer { font-size:11px; color:var(--muted); border-top:1px solid var(--line); margin-top:28px; padding-top:12px; }
.checklist li { font-size:13px; margin:5px 0; }
a { color:var(--accent); }
@media print { body{background:#fff;} .sheet{box-shadow:none;margin:0;max-width:none;padding:0 12mm;} h2{page-break-after:avoid;} .finding{page-break-inside:avoid;} }
`;

function findingHtml(f) {
  const cls = f.severity === 'priority' ? 'priority' : f.severity === 'review' ? 'review' : 'info';
  const ev = (f.evidence ?? []).length
    ? `<div class="ev">Evidence: ${f.evidence.map(linkify).join('; ')}</div>`
    : '';
  return `<div class="finding ${cls}"><span class="sev">${esc(f.severity)}</span> ${linkify(f.text)}${ev}</div>`;
}

function sectionHtml(title, m) {
  if (!m) return '';
  return (
    `<h2>${esc(title)}</h2>` +
    `<div class="narr">Sub-score ${m.score}/100 · ${esc(m.confidence)} confidence — ${esc(m.narrative)}</div>` +
    (m.findings ?? []).map(findingHtml).join('')
  );
}

export function renderHtmlReport(assessment) {
  const { identity } = assessment;
  if (!identity.registry) {
    return page(
      `AeroRisk — ${esc(identity.nNumber)}`,
      `<h1>AeroRisk Aircraft Due-Diligence Pack</h1>
       <p class="sub">${esc(identity.nNumber)}</p>
       <div class="verdict">${esc(assessment.plainVerdict)}</div>
       <ul>${identity.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
       <div class="disclaimer">${esc(DISCLAIMER)}</div>`,
    );
  }

  const reg = assessment.registry;
  const mod = (k) => assessment.modules.find((m) => m.key === k);
  const bandClass = BAND_CLASS[assessment.band?.label] ?? 'some';

  const identityRows = [
    ['N-number', identity.nNumber],
    ['Make / model', `${reg.MFR} ${reg.MODEL}`],
    ['Serial', reg.SERIAL_NUMBER],
    ['Engine', `${reg.ENG_MFR} ${reg.ENG_MODEL}`],
    ['Year', reg.YEAR_MFR],
    ['Registration status', `${reg.STATUS} (expires ${reg.EXPIRATION_DATE || 'n/a'})`],
    ['Registrant', `${reg.REGISTRANT_NAME}, ${reg.CITY}, ${reg.STATE}`],
    ['Identity confidence', identity.confidence],
  ].map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');

  const subScores = assessment.modules
    .map((m) => `<tr><td>${esc(m.label)}</td><td>${m.score}/100</td><td>${esc(m.confidence)}</td></tr>`)
    .join('');

  const topFindings = assessment.topFindings.length
    ? `<ol>${assessment.topFindings.map((f) => `<li>${linkify(f.text)}</li>`).join('')}</ol>`
    : '<p class="narr">No priority or review-level findings in the loaded public records.</p>';

  const checklistItems = buyerChecklist(assessment);
  const checklist = checklistItems.length
    ? `<h2>Buyer checklist</h2><ul class="checklist">${checklistItems.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
    : '';

  const body = `
    <h1>AeroRisk Aircraft Due-Diligence Pack</h1>
    <p class="sub">${esc(identity.nNumber)} — ${esc(reg.YEAR_MFR)} ${esc(reg.MFR)} ${esc(reg.MODEL)} · generated ${esc(assessment.generatedAt.slice(0, 10))}</p>

    <div class="scorebar">
      <span class="score">${assessment.score}<span style="font-size:16px;color:var(--muted)">/100</span></span>
      <span class="band ${bandClass}">${esc(assessment.band.label)}</span>
    </div>
    <div class="verdict">${esc(assessment.plainVerdict)}</div>
    <p class="narr">${esc(assessment.summaryLanguage)} Report confidence: ${esc(assessment.reportConfidence)}.</p>

    <h2>Top findings</h2>
    ${topFindings}

    <h2>Aircraft identity</h2>
    <table>${identityRows}</table>

    <h2>Risk sub-scores</h2>
    <table><tr><th>Signal</th><th>Score</th><th>Confidence</th></tr>${subScores}</table>

    ${sectionHtml('Registration & ownership', mod('registration'))}
    ${sectionHtml('Maintenance & defect signals', mod('maintenance'))}
    ${sectionHtml('Airworthiness Directive exposure', mod('adExposure'))}
    ${sectionHtml('Accident / incident history', mod('accidents'))}
    ${sectionHtml('Utilisation profile', mod('utilisation'))}
    ${sectionHtml('Operator / compliance context', mod('enforcement'))}
    ${sectionHtml('Airport / environment context', mod('airport'))}
    ${sectionHtml('Human-factors themes', mod('humanFactors'))}

    ${checklist}

    <div class="disclaimer">${esc(DISCLAIMER)}</div>
  `;

  return page(`AeroRisk — ${esc(identity.nNumber)}`, body);
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><style>${STYLE}</style></head>
<body><div class="sheet">${body}</div></body></html>`;
}
