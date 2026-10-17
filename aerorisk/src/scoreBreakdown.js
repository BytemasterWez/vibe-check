// Scoring V1 — the named score components from the ingestion spec, each with
// its value and the evidence identifiers behind it. This is the structured,
// machine-readable companion to the narrative report: the batch enrichment
// layer emits one of these per aircraft.
//
// Components map to spec names exactly:
//   identity_confidence, registration_status_score, deregistration_history_flag,
//   sdr_tail_score, sdr_model_score, ntsb_direct_event_score,
//   ntsb_model_context_score, ad_exposure_score, overall_review_priority

function evidenceFor(module, predicate) {
  if (!module) return [];
  return module.findings
    .filter((f) => (predicate ? predicate(f) : true))
    .flatMap((f) => f.evidence ?? []);
}

export function buildScoreBreakdown(assessment) {
  const mod = (key) => assessment.modules.find((m) => m.key === key);
  const registration = mod('registration');
  const maintenance = mod('maintenance');
  const accidents = mod('accidents');
  const adExposure = mod('adExposure');

  const component = (name, value, evidence, note) => ({ name, value, evidence, note });

  return [
    component('identity_confidence', assessment.identity.confidence,
      [`FAA registry record for ${assessment.identity.nNumber}`],
      'Confidence that public records resolve to the correct aircraft.'),

    component('registration_status_score', registration?.score ?? 0,
      evidenceFor(registration, (f) => !/deregistration/i.test(f.text)),
      'Ownership churn, trustee registration, and recency of the last change.'),

    component('deregistration_history_flag',
      Boolean(registration?.detail?.deregistrationHistoryFlag),
      evidenceFor(registration, (f) => /deregistration|deregist|cancel/i.test(f.text)),
      'True if this mark was previously deregistered and re-registered.'),

    component('sdr_tail_score', maintenance?.detail?.sdrTailScore ?? 0,
      evidenceFor(maintenance, (f) => /Tail-specific/i.test(f.text)),
      'Service difficulty reports referencing this exact tail number.'),

    component('sdr_model_score', maintenance?.detail?.sdrModelScore ?? 0,
      evidenceFor(maintenance, (f) => /Model-level/i.test(f.text)),
      'Fleet-wide SDR themes — context for the pre-buy, not a claim against this airframe.'),

    component('ntsb_direct_event_score', accidents?.detail?.ntsbDirectEventScore ?? 0,
      evidenceFor(accidents, (f) => /Direct NTSB/i.test(f.text)),
      'NTSB events directly referencing this tail/serial.'),

    component('ntsb_model_context_score', accidents?.detail?.ntsbModelContextScore ?? 0,
      evidenceFor(accidents, (f) => /Same-model/i.test(f.text)),
      'Same-model NTSB cause themes — discussion context only.'),

    component('ad_exposure_score', adExposure?.score ?? 0,
      evidenceFor(adExposure),
      'Applicable airworthiness directives. Exposure, not non-compliance.'),

    component('overall_review_priority', assessment.score,
      [],
      `${assessment.band?.label ?? 'n/a'} — ${assessment.summaryLanguage}`),
  ];
}
