# Evidence store (provenance-classed)

Every piece of evidence the laboratory reasons over carries a **provenance
class** (see `lib/provenance.mjs`). A claim must not advance merely because it
passed internally generated trials — provenance is what separates "internally
self-consistent" from "externally valid".

| Directory | Provenance class | Autonomous? | Ingest gate |
| --- | --- | --- | --- |
| `simulated/` | `simulated` | yes | — the loop produces this itself |
| `public-datasets/` | `public_dataset` | no | `NEEDS_EXTERNAL_DATASET` |
| `recorded-hardware/` | `recorded_hardware` | no | `NEEDS_HARDWARE` |
| `manually-labelled/` | `manually_labelled` | no | `NEEDS_HUMAN_LABELS` |
| `third-party-reproductions/` | `third_party_reproduction` | no | `NEEDS_CLINICAL_REVIEW` |

Only `simulated/` is populated autonomously (receipts live in `data/receipts`).
The other directories are adapters: dropping conforming evidence in one of them
is a governance action a human takes, and it is what lets a claim earn external
validity beyond the simulator worlds. Until then the loop reports the gap via an
escalation rather than advancing on simulator evidence alone.
