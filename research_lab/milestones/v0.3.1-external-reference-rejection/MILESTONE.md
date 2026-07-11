# Milestone v0.3.1 — external reference rejection

An **operational evidence-processing** milestone, **not** a performance maturity
level. It records that the laboratory executed a genuine external-evidence
crossing and correctly **refused to score** it because the dataset's reference
did not satisfy the frozen respiratory contract. It does **not** imply
`E1-EXTERNAL-REPLAY`.

## What was proven

The lab can acquire and hash-bind 2 GB of foreign evidence, decode genuine raw
radar, isolate scorer truth, reproduce normalized observations exactly, determine
claim applicability, and **reject an apparently relevant dataset because its
reference standard does not satisfy the frozen contract** — without weakening any
rule. That is stronger evidence about the laboratory than forcing an ECG-derived
respiration estimate would have been.

## Terminal outcome

```
external_evidence_attempted: true
external_dataset_decoded:    true
adapter_reproduced:          true
truth_isolation_verified:    true
claims_scored:               false
external_maturity:           E0
terminal_outcome:            REFERENCE_UNUSABLE
reason:                      direct respiratory reference absent (ECG/PCG only)
```

## Dual evidence status (more informative than "unusable")

```
radar_observations_status:   USABLE
respiratory_reference_status: UNUSABLE
dataset_terminal_outcome:     REFERENCE_UNUSABLE
```

The Mendeley radar observations remain a valid asset for raw multi-target
geometry, decoder validation, spatial-processing development, observational-
ambiguity experiments, and (later) secondary EDR research — while the
respiratory reference stays unusable.

## Immutability & EDR policy

- `code_baseline_commit: 69a4a1e` (the crossing commit).
- The original external receipt (`evidence/external/receipts/EXT-RR-MULTI-001.receipt.json`)
  is **not** overwritten; a copy is archived here.
- **ECG-derived respiration (EDR) was not added and must not be added
  retrospectively.** If pursued, it becomes a separately preregistered reference
  candidate (`REF-EDR-001`, see `registry/references/REF-EDR-001.json`), first
  validated against a *direct* respiratory reference on another dataset, and it
  must never change this primary `REFERENCE_UNUSABLE` verdict.

## Operational marker (not on the performance ladder)

`X1-EXTERNAL-ADMISSIBILITY-EXERCISED` — a genuine external package was acquired,
decoded, normalized, reproduced, truth-isolated, and correctly refused scoring.
Exposed as an operational marker in `lib/external/maturity.mjs`
(`OPERATIONAL_MARKERS`), deliberately separate from `E1..E3/H1/H2` so it can never
be mistaken for external estimator validation.

## Maturity ledger at this milestone

```
C5-SIMULATED                        RR-001/002/003/004B at software ceiling; RR-004 falsified
X1-EXTERNAL-ADMISSIBILITY-EXERCISED  (operational) genuine external package processed + reference-rejected
E1-EXTERNAL-REPLAY                   NOT reached (no applicable respiratory claim scored)
E2-EXTERNAL-REPRODUCED               NOT reached
E3-CROSS-DATASET                     NOT reached
H1-BENCH-HARDWARE                    NOT reached
```

## Next step (separate tracks)

- **Track A** — single-person, direct-belt-referenced external radar data → earn `E1`/`E2`.
- **Track B** — multi-person attribution (RR-004B external) → remains blocked until a
  dataset with simultaneous people AND person-specific direct respiratory truth
  exists, or a controlled two-target hardware experiment is run.

`v0.4.0-external-and-hil-entry` remains untagged and requires both a scored
external E1/E2 result AND the physical HIL portion.
