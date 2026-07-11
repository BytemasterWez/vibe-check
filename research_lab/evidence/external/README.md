# External evidence (human-gated)

The autonomous loop **cannot** place evidence here. Ingesting a real recording is
a governance action a human takes, because it carries a licence, a provenance
class, and subject metadata the loop must not invent. Until a real, *eligible*
dataset is dropped in, the loop reports the gap via a `NEEDS_EXTERNAL_DATASET`
escalation and does not advance any claim onto the external maturity track.

```
external/
  adapters/     adapter code/config per dataset (declares the transformation pipeline)
  manifests/    per-recording manifests (provenance, hashes, transformations)
  raw/          raw bytes as received (hash-bound; never edited in place)
  normalized/   estimator-facing normalized signals (no truth fields)
  labels/       reference labels — scorer-only, never mounted for the estimator
  receipts/     external-evaluation receipts
```

Before any claim is evaluated on a recording it must pass the **adapter
validation contract** (`lib/external/contract.mjs`) and **dataset eligibility**
(`lib/external/eligibility.mjs`), and subject/session split protection
(`lib/external/eligibility.mjs#checkSubjectSplit`). An estimator result on
corrupted or leaked evidence is worthless, so the adapter is validated before the
estimator ever runs.

The maturity levels reachable with external evidence (`E1`..`E3`, `H1`, `H2` —
see `lib/external/maturity.mjs`) are all **human-gated**: reaching them requires
provenance the autonomous loop is forbidden to produce, and `E3` requires two
independently acquired datasets so one small dataset cannot cause a large
maturity jump.

`lib/external/fixture.mjs` is a labelled *synthetic* recording used only to
self-test this plumbing. It is not real external evidence — eligibility rejects
its provenance — and no claim advances on it.
