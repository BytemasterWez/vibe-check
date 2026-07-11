# External decision brief — EXT-RR-MULTI-001 (first genuine crossing)

**Outcome: `REFERENCE_UNUSABLE` for all respiratory-rate claims. Crossing successful; no frozen rule altered; external maturity did NOT advance.**

## What was downloaded

- Dataset: *FMCW radar-based multi-person vital sign monitoring data* — Guangyu Lei, Wei Cheng, Xipeng Yin, Yuqing Wu. Mendeley Data V1, **doi:10.17632/684v4r8wfr.1**.
- Licence: **CC BY 4.0**, read from the **Mendeley dataset landing record** (not the accompanying article). Recorded in `manifests/EXT-RR-MULTI-001.attribution.json`.
- 490 files, 2.0 GB: 162 raw `.bin` (TI IWR6843/DCA1000, 60 GHz FMCW), 162 + 162 reference CSVs (Target1/Target2), authors' `read_log.m` + `RadarDataProcessing.zip`, 2 descriptor PDFs.
- Full hash-bound source manifest (every file's repository SHA-256) committed; descriptor PDFs + processing code + a verified recording subset were retrieved and hash-checked. Raw data is git-ignored; reproduce it with `external_bootstrap.mjs`.

## Hashes / integrity

- Canonical source-manifest SHA-256 recorded in `manifests/EXT-RR-MULTI-001.source.json`.
- The evaluated recording (`adc_3GHZ_position3_ (1).bin`) SHA-256 matches the canonical Mendeley hash exactly.
- Adapter reproduces the normalized signal bit-identically on re-run.

## Adapter outcome

- `lib/external/adapters/mendeley_684v4r8wfr_v1.mjs` decodes the raw ADC exactly per the authors' `readDCA1000.m` (int16 IQ → range-FFT(256) → MTI → dominant range-bin phase), producing a 2-channel observation at 20 Hz. **1200 slow-time frames recovered; a respiration-band signal is present** → the `.bin` is deterministically interpretable (not `ADAPTER_INVALID`).

## Truth isolation

- Reference CSVs parsed only into scorer-owned truth; estimator input carries no reference/truth fields. `truth_isolation_verified = true`.

## Claims applicable

- The dataset's geometry (Table 1) *does* establish distinct-range (Position 3/4/5/6) and co-located (Position 7/8/9) two-subject configurations — well matched to `CLM-RR-004B` (distinct range) and `CLM-RR-004`/`HIL-AMB-002` (co-located). So the radar side is directly relevant.

## Why it still could not be scored — the binding limitation

The validation reference is an **ECG front-end (ADS1292R)**; the CSV channels are **ECG and PCG (both cardiac)**, ~125 Hz. Measured respiratory-band energy fraction is negligible (0.00–0.19) and there is **no direct respiratory belt/capnography trace**. Our respiratory-rate claims freeze `reference_standard = respiratory_belt_or_capnography`. Deriving respiration from ECG (EDR) is an undocumented, tunable transform this crossing must not improvise or tune to make the radar agree. Therefore every respiratory-rate claim is **`REFERENCE_UNUSABLE`** on this dataset.

## Did RR-004B survive external evidence?

**Undetermined by this dataset.** RR-004B was neither confirmed nor refuted externally, because the dataset cannot supply a respiratory ground truth to score against. This is a reference limitation, not an estimator result — recorded honestly rather than forced to a PASS.

## Maturity reached

- Simulated: **C5-SIMULATED** (unchanged).
- External: **not advanced.** `E1-EXTERNAL-REPLAY` requires ≥1 applicable claim evaluated against a *usable* reference; none was scorable.

## Remaining blocker to the v0.4.0 milestone

A dual-subject radar dataset with a **direct respiratory reference** (belt / RIP / capnography), OR a separately governed, frozen ECG-derived-respiration reference protocol added to the claim's `reference_standard`. The recommended path is to source **external dataset two** with a respiratory reference (e.g. a UWB/RIP dataset), which would also open `E3-CROSS-DATASET` later. Until then, do **not** create `v0.4.0-external-and-hil-entry`: the crossing consumed real external data and held every rule, but the respiratory claims have not yet been externally replayed.

## Recommendation

Accept this as a valid, informative first crossing. Retain EXT-RR-MULTI-001 as verified external provenance and a real radar test bed for future angular/MIMO work (which the frozen 2-channel estimator does not perform). Do not weaken the respiratory reference standard to manufacture a score.
