# Runbook — first scored external evaluation (E1 → E2), EXT-RR-BELT-001

Purpose: complete the **first scored and reproduced** external evaluation on
**one** participant from the 4TU three-radar dataset, without modifying any
frozen estimator/claim/reference rule. This does **not** establish population
performance and does **not** satisfy physical HIL maturity. `v0.4.0` stays
untagged.

## Why this runs off-box

The constrained Claude environment (~30 GB disk, GitHub API scoped, no MATLAB)
is exhausted for this: the dataset is **140.8 GB** (6.6–9.4 GB per participant)
and the Dopplium `.bin` format must be derived from the authors' MATLAB. Provision
a temporary machine (~100–150 GB disk, 8–16 GB RAM, 4+ cores, Ubuntu; no GPU
needed). Estimated spend £10–£30.

## Layout (data OUTSIDE git)

```
external-data/4tu-three-radar-v1/{source,extracted,normalized,truth,outputs,manifests}
```
Git holds only: source manifest, bootstrap, hashes, adapter, frozen protocols,
eligibility/ledgers, receipts, results, reproduction instructions.

## Frozen BEFORE scoring (already committed)

- `research_lab/registry/references/REF-BELT-001.json` — belt reference protocol.
- `research_lab/registry/references/REF-SYNC-BELT-001.json` — synchronization protocol.
- `research_lab/lib/estimators/ensemble.config.json` — frozen ensemble.
- Claims + acceptance in `research_lab/registry/claims/`.
Do not edit these after seeing results; a change is a new version, not an update.

## Steps (map to the packet stages)

1. **Acquire (content-addressed).** Pick the smallest complete participant with
   the required radar+belt recordings. Download to `source/` outside git:
   `node research_lab/external_bootstrap.mjs fetch EXT-RR-BELT-001 --only Participant8 --dest external-data/4tu-three-radar-v1/source`
   The bootstrap records computed SHA-256 (4TU exposes none). Build the canonical
   sorted source manifest (path, size, sha256, participant, activity, radar, type).
2. **Format spec.** Fill `docs/formats/dopplium-v1.md` UNVERIFIED fields from the
   authors' MATLAB + byte invariants. Write `lib/external/adapters/dopplium_4tu_v1.mjs`
   that refuses files whose size ≠ the embedded-param payload formula.
3. **Decoder cross-check.** Compare adapter intermediates to the authors' MATLAB
   (frame/chirp/sample/channel counts, config, duration, representative complex
   samples, range-FFT dims) within recorded tolerances. No validity from a
   plausible waveform alone.
4. **Reference + sync are already frozen** (REF-BELT-001 / REF-SYNC-BELT-001).
   Alignment MUST NOT be chosen to minimize radar error; fold residual timing
   uncertainty into the error tolerance. Failure → `REFERENCE_UNUSABLE` /
   `TIME_ALIGNMENT_UNRECOVERABLE`.
5. **Truth isolation** at filesystem level: estimator reads only `input/`; belt
   truth in `truth/`; outputs finalized before truth is opened. Assert no truth
   in filenames/metadata; block symlink/traversal.
6. **Recording selection** for CLM-RR-001 conditions only; inclusion/exclusion
   ledger BEFORE scoring, using only the frozen objective reason codes. Never
   exclude for poor candidate performance.
7. **Independent radar evaluation** — keep the three radars SEPARATE. Run
   fft_peak, autocorr, robust_ensemble_v1, and robust_ensemble_v2 (only if its
   two-channel input contract is genuinely met on a single radar; else
   `SIGNAL_TYPE_INCOMPATIBLE`). Report per participant/activity/recording/radar:
   reference rate, estimate, abs error, confidence, abstention, false-confident,
   sync uncertainty, outcome.
8. **Cross-radar analysis** — descriptive only; does not change primary outcomes;
   no new three-radar ensemble without a new preregistered candidate version.
9. **Statistics** — window (descriptive if overlapping), recording, activity,
   participant. Do not treat overlapping windows as independent. For CLM-RR-003
   use only genuinely independent empty-room recordings; if the exact one-sided
   95% upper bound stays > 0.001, report `INSUFFICIENT_EVIDENCE` even at 0 events.
10. **E1 receipt** when: eligible evidence, usable direct belt reference, adapter
    validated, truth isolation verified, normalized evidence deterministic, ≥1
    applicable claim, ≥1 candidate scored, signed receipt. E1 does **not** require
    a passing estimator. Record scientific outcome separately from maturity.
11. **E2** — a separate clean run reproduces exactly: normalized-evidence hash,
    estimator-output hashes, score-bundle hash, inclusion/exclusion-ledger hash,
    terminal-outcome hash. **Exclude absolute paths, timestamps, machine ids** from
    the reproducibility hashes.
12. **Report** per the packet's required list; commit receipts/results/manifests
    (not raw data). Do not tag `v0.4.0` (needs a physical HIL experiment too).

## After E2

Clean success → expand to several participants (generalization). Mixed per-radar
→ diagnose geometry. Broad failure → improve only as a NEW frozen candidate
version. Format/sync failure → preserve the failure; repair the adapter/reference
protocol without changing prior receipts.
