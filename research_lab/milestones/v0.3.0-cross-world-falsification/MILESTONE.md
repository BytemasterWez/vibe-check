# Milestone v0.3.0 — cross-world falsification

A formal, frozen record of the pre-hardware laboratory at the point it first
demonstrated that it can **kill a weak claim**, not merely promote strong ones.
This baseline should not be modified in place; later work is compared against it.

## Code baseline

- `code_baseline_commit: 1bdbdeb21678db6370ec9db6785382662ca35397`
  (tree `911ab8c31d7ae28ab9dfb2e35c2852f75b074ea0`) — the `research_lab`
  cross-world build the archived receipts were generated from, before any
  Packet 3 changes.
- `milestone_archive_commit: ac1651cc7043274b22b16821ee608f99b2f6272d` — the
  commit that adds this milestone directory (MILESTONE.md + receipts + summary).
- `tag_target_commit: ac1651cc7043274b22b16821ee608f99b2f6272d` — the annotated
  tag `v0.3.0-cross-world-falsification` dereferences here.
- Archived receipt bundle sha256 (concatenated, this directory's `receipts/`):
  `b2a081f2d16ff436c24e716af182a98309d4a35a4994761076edc3f56170064c`

Note: the tag exists locally and points at `ac1651c`. If the remote tag push is
rejected (the session token may be scoped to branch refs only), a maintainer can
publish it with `git push origin refs/tags/v0.3.0-cross-world-falsification`.

## Test totals (offline, deterministic)

| Suite | Result |
| --- | --- |
| `research_lab/test/smoke.mjs` | 34 checks passed |
| `research_lab/test/mutation.mjs` | 5 governance mutants killed, 0 survived |
| `research_lab/test/cross_world.mjs` | 8 checks passed (overfit exposed + rejected) |

## Default-claim outcomes

Candidate under test: `robust_ensemble_v1`; baseline `fft_peak_v1`.
Campaign: 21 experiments, 20 passed, 1 failed. Governor counters clean
(`protocol_tamper_events=0`, `unsupported_promotion_attempts=0`).

| Claim | Outcome | Maturity | Note |
| --- | --- | --- | --- |
| CLM-RR-001 | ceiling reached | C5 | clean + apparatus-motion across 3 world families |
| CLM-RR-002 | ceiling reached | C5 | periodic motion >= respiration; no confident wrong rate |
| CLM-RR-003 | ceiling reached | C5 | target-absent false-positive rate 0 over 1200 trials |
| **CLM-RR-004** | **FALSIFIED** | C3 | ensemble **misattributes** on the biomechanical second-person world (fcr 0.067 > 5%) despite passing the sinusoidal and nonstationary intruder worlds |
| CLM-SYNC-001 | blocked | C2 | `NEEDS_NEW_SIMULATOR` — no clock-sync world exists |

Full machine-readable state: `campaign-summary.json`; signed per-experiment
receipts: `receipts/` (public receipts only; signing keys are never archived).

## What this milestone proves

The control loop and its guardrails: cross-world quorum (no advancement on a
single friendly world), two-stage advancement (hard safety constraints gate
before utility), protocol-freeze integrity, exact reproduction, separation of
duties, autonomy containment, and — crucially — that an estimator overfit to one
world is exposed and rejected. The falsification of CLM-RR-004 is the headline:
the system produced an answer we did not want.

## What it does NOT prove

That the simulated signals reflect real sensor physics; that any estimator works
on real humans; that the worlds cover the dangerous confounders; or that the
ensemble survives real hardware. All successful evidence here is still generated
inside the laboratory's own software universe. Closing that gap — external
evidence and observational independence — is Packet 3, and this milestone is the
baseline it must improve upon without weakening any frozen rule.
