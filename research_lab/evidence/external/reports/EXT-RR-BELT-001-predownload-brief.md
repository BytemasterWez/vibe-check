# Pre-download brief — EXT-RR-BELT-001 (Track A candidate)

**Status: `ELIGIBLE` (pre-download). Primary applicable claim: `CLM-RR-001`. Full scored E1/E2 execution deferred — see execution prerequisites.**

## Resolved from the repository itself

- *Dataset of vital sign measurements with three FMCW radars at elevated position — Nov 2025* — Wendelmuth, Yarovoy, Fioranelli (TU Delft).
- **DOI `10.4121/169cadca-e5dd-46e7-a9c5-91a4c9b1ff28.v1`**, 4TU.ResearchData, **CC BY 4.0** (confirmed from the 4TU Djehuty record + DataCite `cc-by-4.0`, not a secondary catalogue).
- 19 files, **140.8 GB** (18 per-participant zips 6.6–9.4 GB + Readme). No per-file md5 exposed by the API.

## Why this is the right Track-A source

It supplies the **direct respiratory-belt reference** (Vernier Go Direct) our frozen contract requires — the exact thing EXT-RR-MULTI-001 lacked. Raw radar (3× Dopplium/IWR6843ISK, FDMA 60/61.25/62.5 GHz, 10 Hz frame rate, params embedded in the `.bin`), 18 participants, 6 activities, plus empty-room calibration.

## Claim applicability (do not over-claim)

| Claim | Outcome | Reason |
| --- | --- | --- |
| **CLM-RR-001** | **APPLICABLE** | single stationary adult, activities 1–4 (sitting/lying still). The route to first scored E1. |
| CLM-RR-002 | `CLAIM_NOT_APPLICABLE` | no controlled periodic apparatus motion (only subject restlessness). |
| CLM-RR-003 | `APPLICABLE_LIMITED` | empty-room calibration gives target-absent data, but too few independent windows for the 0.001 bound → expect INSUFFICIENT_EVIDENCE, not a forced pass. |
| CLM-RR-004 / 004B | `CLAIM_NOT_APPLICABLE` | **single-person dataset** — three radars are not three people. RR-004B external confirmation stays blocked (Track B). |

## Execution prerequisites (why E1/E2 is deferred, honestly)

1. **Format**: the `.bin` is the Dopplium format with parameters embedded in-file; it needs the *Dopplium parser* (`Dopplium/dopplium-parser`). The EXT-RR-MULTI-001 `readDCA1000` adapter does **not** apply — a new versioned adapter is required.
2. **Storage**: 140.8 GB total; per-participant ~7–9 GB zip → ~13–19 GB extracted. This exceeds the current sandbox's ~30 GB working disk. A full scored campaign must run where ≥ ~50 GB is available (one participant is borderline).
3. **Sync**: radar and belt were aligned *manually* — the frozen reference-processing/alignment protocol must be fixed before scoring.

## Recommendation

Proceed on an environment with adequate disk: port the Dopplium parser into a versioned adapter, download the smallest participant zip, decode activities 1–4 for `CLM-RR-001`, freeze the belt reference-processing protocol, isolate truth, and score → **E1** (a valid FAIL/ABSTAIN also earns E1), then a clean rerun → **E2**. Keep RR-004/004B `CLAIM_NOT_APPLICABLE`. Do not tag `v0.4.0` on an E1/E2 result alone — it also requires the physical HIL portion.

## Track separation (confirmed)

- **Track A** (this dataset): single-person direct-belt E1/E2 — unblocked, pending disk + adapter.
- **Track B** (multi-person attribution / RR-004B external): still blocked. No verified public dataset yet provides simultaneous people + person-specific direct respiratory truth. EXT-RR-MULTI-001 has multi-person radar but only a cardiac reference; EXT-RR-BELT-001 has a belt reference but single-person. The remaining gap is a dataset (or a controlled two-target hardware experiment) with **both**.
