// Evidence provenance classes (build-packet §4).
//
// A claim must not advance merely because it passed thousands of INTERNALLY
// generated trials. Every piece of evidence carries a provenance class, and only
// simulated evidence can be produced autonomously; everything else requires a
// human/hardware gate to ingest. The diversity report and the escalation logic
// read these classes to decide when the lab has hit the edge of what it can
// prove on its own.

export const PROVENANCE = {
  simulated: {
    class: 'simulated',
    autonomous: true,
    description: 'signals synthesized by the lab’s own simulator worlds',
    external_validity: 'none — internal consistency only',
  },
  public_dataset: {
    class: 'public_dataset',
    autonomous: false,
    ingest_escalation: 'NEEDS_EXTERNAL_DATASET',
    description: 'a third-party public dataset we did not generate',
    external_validity: 'partial — depends on population + method match',
  },
  recorded_hardware: {
    class: 'recorded_hardware',
    autonomous: false,
    ingest_escalation: 'NEEDS_HARDWARE',
    description: 'recordings from physical apparatus against a reference standard',
    external_validity: 'high for the tested apparatus',
  },
  manually_labelled: {
    class: 'manually_labelled',
    autonomous: false,
    ingest_escalation: 'NEEDS_HUMAN_LABELS',
    description: 'human-annotated observations',
    external_validity: 'depends on labelling protocol',
  },
  third_party_reproduction: {
    class: 'third_party_reproduction',
    autonomous: false,
    ingest_escalation: 'NEEDS_CLINICAL_REVIEW',
    description: 'an independent group reproduced our result',
    external_validity: 'high — independent of our simulator + code',
  },
};

// Provenance classes the autonomous loop is allowed to produce by itself.
export const AUTONOMOUS_PROVENANCE = Object.values(PROVENANCE)
  .filter((p) => p.autonomous)
  .map((p) => p.class);

export function isAutonomous(provenanceClass) {
  return AUTONOMOUS_PROVENANCE.includes(provenanceClass);
}

// The escalation required to bring a non-autonomous provenance class into the
// ledger — used when a claim needs evidence the simulators cannot supply.
export function ingestEscalationFor(provenanceClass) {
  const p = PROVENANCE[provenanceClass];
  return p && !p.autonomous ? p.ingest_escalation : null;
}
