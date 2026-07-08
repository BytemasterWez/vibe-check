// Renders an assessment as the AeroRisk Aircraft Due-Diligence Pack —
// the 10-section markdown report defined in the product spec. Markdown is the
// working format; PDF is a rendering step on top (pandoc, md-to-pdf, etc.).

export const DISCLAIMER =
  'This report summarises publicly available records. It is not a safety certification, ' +
  'an airworthiness determination, or an accusation against any person or entity. ' +
  'Findings identify public records worth reviewing before a financial, legal, insurance, ' +
  'maintenance, or charter decision. Verify every record against original sources and the ' +
  'aircraft’s own documents before acting.';

function formatValue(v) {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return `${v}/100`;
  return String(v);
}

export function renderReport(assessment) {
  const { identity } = assessment;
  if (!identity.registry) {
    return [
      '# AeroRisk Aircraft Due-Diligence Pack',
      '',
      `**Aircraft:** ${identity.nNumber}`,
      '',
      '**Identity could not be resolved.**',
      '',
      ...identity.issues.map((i) => `- ${i}`),
      '',
      `> ${DISCLAIMER}`,
      '',
    ].join('\n');
  }

  const reg = assessment.registry;
  const mod = (key) => assessment.modules.find((m) => m.key === key);
  const lines = [];
  const push = (...xs) => lines.push(...xs, '');

  push('# AeroRisk Aircraft Due-Diligence Pack');
  push(`> ${DISCLAIMER}`);

  // Section 1 — Executive summary
  push('## 1. Executive summary');
  push(
    `**Aircraft reviewed:** ${identity.nNumber} — ${reg.YEAR_MFR} ${reg.MFR} ${reg.MODEL} (s/n ${reg.SERIAL_NUMBER})`,
    '',
    `**Overall review priority:** ${assessment.score}/100 — ${assessment.band.label}`,
    '',
    `${assessment.summaryLanguage}`,
    '',
    `**Report confidence:** ${assessment.reportConfidence} (identity confidence: ${identity.confidence})`,
  );
  push('**Top findings:**');
  if (assessment.topFindings.length > 0) {
    push(...assessment.topFindings.map((f, i) => `${i + 1}. [${f.module}] ${f.text}`));
  } else {
    push('No priority or review-level findings in the loaded public records.');
  }
  push('**Sub-scores:**');
  push(
    '| Sub-score | Value | Confidence |',
    '| --- | --- | --- |',
    ...assessment.modules.map((m) => `| ${m.label} | ${m.score}/100 | ${m.confidence} |`),
  );
  push('**Score breakdown (V1 components):**');
  push(
    '| Component | Value | Note |',
    '| --- | --- | --- |',
    ...assessment.scoreBreakdown.map(
      (c) => `| ${c.name} | ${formatValue(c.value)} | ${c.note} |`,
    ),
  );

  // Section 2 — Aircraft identity
  push('## 2. Aircraft identity');
  push(
    '| Field | Value |',
    '| --- | --- |',
    `| N-number | ${identity.nNumber} |`,
    `| Make/model | ${reg.MFR} ${reg.MODEL} |`,
    `| Serial | ${reg.SERIAL_NUMBER} |`,
    `| Engine | ${reg.ENG_MFR} ${reg.ENG_MODEL} |`,
    `| Year | ${reg.YEAR_MFR} |`,
    `| Registration status | ${reg.STATUS} (expires ${reg.EXPIRATION_DATE || 'n/a'}) |`,
    `| Airworthiness class | ${reg.AIRWORTHINESS_CLASS} |`,
    `| Registrant | ${reg.REGISTRANT_NAME} (${reg.REGISTRANT_TYPE}), ${reg.CITY}, ${reg.STATE} |`,
    `| Mode S hex | ${reg.MODE_S_HEX || 'not on file'} |`,
    `| Identity match confidence | ${identity.confidence} |`,
  );
  if (identity.issues.length > 0) {
    push('Identity notes:');
    push(...identity.issues.map((i) => `- ${i}`));
  }

  // Sections 3–9 from modules
  section(push, '3. Registration and ownership', mod('registration'));
  section(push, '4. Maintenance and defect signals', mod('maintenance'));
  section(push, '5. Airworthiness Directive exposure', mod('adExposure'));
  section(push, '6. Accident/incident history', mod('accidents'));
  section(push, '7. Utilisation profile', mod('utilisation'));
  section(push, '8. Operator/compliance context', mod('enforcement'));

  push('## 9. Airport/environment context');
  for (const m of [mod('airport'), mod('humanFactors')]) {
    push(`**${m.label}** — ${m.score}/100 (${m.confidence} confidence)`);
    push(m.narrative);
    push(...renderFindings(m));
  }

  // Section 10 — Buyer checklist
  push('## 10. Buyer checklist');
  push(...buyerChecklist(assessment).map((item) => `- [ ] ${item}`));

  push('---');
  push(
    `_Generated ${assessment.generatedAt} by AeroRisk Due Diligence from the loaded public-record dataset. ` +
      'Evidence identifiers reference the originating public source for manual verification._',
  );

  return lines.join('\n');
}

function section(push, title, m) {
  push(`## ${title}`);
  push(`**Sub-score:** ${m.score}/100 (${m.confidence} confidence)`);
  push(m.narrative);
  push(...renderFindings(m));
}

function renderFindings(m) {
  if (m.findings.length === 0) return ['No findings.'];
  const out = [];
  for (const f of m.findings) {
    out.push(`- **${f.severity}** — ${f.text}`);
    if (f.evidence.length > 0) out.push(`  - Evidence: ${f.evidence.join('; ')}`);
  }
  return out;
}

function buyerChecklist(assessment) {
  const items = [];
  const mod = (key) => assessment.modules.find((m) => m.key === key);

  const ad = mod('adExposure');
  items.push(...(ad.detail?.checklist ?? []));

  if ((mod('maintenance').detail?.tailSdrCount ?? 0) > 0) {
    items.push('Cross-check each tail-specific SDR against logbook entries and repair invoices.');
  }
  if ((mod('maintenance').detail?.modelThemes ?? []).length > 0) {
    const themes = mod('maintenance').detail.modelThemes.map((t) => t.chapter).join(', ');
    items.push(`Ask the pre-buy mechanic to focus on model-level SDR themes: ${themes}.`);
  }
  if ((mod('accidents').detail?.directCount ?? 0) > 0) {
    items.push('Obtain the full NTSB docket(s) and all post-accident repair documentation (337s, work orders).');
  }
  if (mod('registration').score > 0) {
    items.push('Ask the seller to document the chain of ownership and explain each registration change.');
  }
  if ((mod('enforcement').detail?.matchCount ?? 0) > 0) {
    items.push('Verify whether the enforcement respondent is the same legal entity as the current registrant; ask the operator for context.');
  }
  const util = mod('utilisation');
  if ((util.detail?.longestGapDays ?? 0) >= 180) {
    items.push('Ask where the aircraft was stored during inactivity; inspect for corrosion, dried seals, and battery/avionics issues.');
  }
  if ((util.detail?.flightCount ?? 0) === 0) {
    items.push('Request engine/airframe total times and recent logbook entries — no public activity data was available.');
  }

  items.push(
    'Confirm registration status and expiration directly with the FAA registry before closing.',
    'Have an A&P/IA perform a full pre-buy inspection — this report does not replace one.',
    'Share this pack with your insurer/lender so their questions surface before closing.',
  );
  return items;
}
