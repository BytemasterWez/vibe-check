# Autonomous Pre-Hardware Sensing Laboratory

A closed, deterministic research loop that automates the *pre-hardware* science
of a clinical sensing capability. It maintains a machine-readable claim ledger,
finds the highest-uncertainty claim, designs and **preregisters** falsification
experiments, executes them in isolation against **frozen** acceptance criteria,
red-teams and reproduces the results, and advances claim maturity — **never past
the pre-hardware ceiling (C5)**, and **never on evidence from a single simulated
world**.

The deliverable is not a scanner. It is a defensible map of *what is observable,
under which conditions, with what evidence* — and the smallest set of physical
experiments still required. Your attention is needed only at governance gates.

Zero-dependency Node (`node:crypto` only), file-based, deterministic: every gate
decision is code, not a model call.

## The central idea: defeat self-consistency

A single estimator can "succeed" simply by sharing assumptions with the
simulator that generated the test. This laboratory is built to catch that:

- **Multiple structurally different worlds** generate the signals
  (`lib/simulators/`): a stationary `sinusoidal` model, a `nonstationary`
  drifting model, a `biomechanical` asymmetric chest-wall model, and a
  `target_absent` empty-scene model. An estimator does not know which world
  produced a trial.
- **Multiple independent estimators** (`lib/estimators/`): a spectral peak
  finder, an IMU-cancelling spectral estimator, a time-domain
  `autocorr` estimator, and a `robust_ensemble` that reports **only when the
  independent methods agree** — plus a deliberately overfit `sinusoid_template`
  kept as a negative control.
- **A cross-world quorum**: a claim advances only when ≥ `min_families`
  independent world families pass *and* the hard safety constraints pass. A
  candidate that is brilliant on one world but fails another is **falsified**,
  not promoted.

The proof milestone (`npm run lab:test:cross-world`) drives this directly: the
overfit estimator is brilliant on its home world, then **falsified** by the
independent target-absent world, while the ensemble reaches its ceiling.

### Three kinds of independence

Cross-world quorum gives **algorithmic** and **world** independence. But two
mathematically different methods reading the *same mixed channel* can still agree
confidently on the wrong source — mathematical independence is not
**informational** independence. This is why `CLM-RR-004` was falsified (the
ensemble misattributed a second person). The fix (`robust_ensemble_v2`) is
observational, not algorithmic: each world now exposes a **second spatial
channel**, and a **multi-target ambiguity detector** (`lib/detectors/ambiguity.mjs`)
abstains when the two channels disagree on the dominant source, *before* any rate
is trusted. `CLM-RR-004B` (distinct-range intruder) passes with v2 and fails with
v1. A co-located intruder at a similar range remains unresolvable with two
channels — a documented limit that escalates to richer sensing, not a bug. See
`docs/RR-004-root-cause.md`.

### Frozen, versioned ensemble

The ensemble's members, agreement tolerance and voting logic are frozen in
`lib/estimators/ensemble.config.json` with a `config_hash`; the loader refuses to
run if the file was edited without re-freezing. A changed config is a **new
candidate version** (`robust_ensemble_v2`), never a silent update to an existing
result — essential once external recordings are in play.

### Rare-event safety uses confidence bounds

"Zero failures in a small test" is weak evidence, so the dangerous-confidence
classes are gated on a **Clopper-Pearson 95% upper bound** (`lib/stats.mjs`), not
a point rate. The target-absent false-positive limit of `0.001` therefore forces
~3000 clean trials before it can be believed — `CLM-RR-003` runs 3200. The hard
constraint is `false_confident_95pct_upper_bound` / `target_absent_fp_95pct_upper_bound`,
and receipts report `count / trials / upper_bound`, never a bare zero-rate.

### External evaluation outcomes (allowed to disappoint)

`lib/external/evaluate.mjs` runs the full gate chain and returns ONE outcome from
a frozen taxonomy — `PASS`, `FAIL`, `ABSTAIN`, `EVIDENCE_INELIGIBLE`,
`SIGNAL_TYPE_INCOMPATIBLE`, `REFERENCE_UNUSABLE`, `ADAPTER_INVALID`,
`CLAIM_NOT_APPLICABLE` — so a valid dataset that simply lacks the needed spatial
information is *not* recorded as an estimator failure. It emits an external
evidence receipt (raw/normalized hashes, adapter version, subject/session/
recording counts, eligibility, `truth_isolation_verified`) and runs the estimator
against input mounted in a **separate directory** from the scorer's truth.

### Hardware-in-the-loop claims (escalated, never faked)

`HIL-SIG/ABS/MOTION/AMB-001/002` are registered as `recorded_hardware`-gated. The
autonomous loop cannot produce that evidence, so a provenance gate blocks each
and escalates **`NEEDS_HARDWARE`** — including `HIL-AMB-002`, the explicit
*boundary* claim that co-located targets are **not** separable with the current
observation configuration.

### First genuine external crossing (EXT-RR-MULTI-001)

The first real dataset was ingested: *FMCW radar-based multi-person vital sign
monitoring data* (Mendeley `doi:10.17632/684v4r8wfr.1`, **CC BY 4.0**, dual-subject
60 GHz radar). The raw ADC is decoded exactly per the authors' `readDCA1000.m`
(`lib/external/adapters/mendeley_684v4r8wfr_v1.mjs`); the evaluated recording's
SHA-256 matches the canonical Mendeley hash, the decode is deterministic, and
truth is isolated. **Honest outcome: `REFERENCE_UNUSABLE`** — the dataset's
reference is ECG/PCG (cardiac), not a respiratory belt/capnography trace, so a
respiratory rate cannot be scored without an undocumented ECG-derived-respiration
transform the crossing must not improvise. No frozen rule was altered and the
external maturity track did **not** advance (`E1` needs a usable reference). Full
provenance, quarantine, eligibility, receipt and decision brief live under
`evidence/external/`; raw data is git-ignored and reproduced via
`external_bootstrap.mjs` (content-addressed, hash-verified). See
`evidence/external/reports/EXT-RR-MULTI-001-decision-brief.md`. This is the lab
working as intended: it consumed real outside data and refused to manufacture a
reference to force a PASS.

### External evidence (human-gated)

`lib/external/` is the framework for evidence the lab did not generate: a generic
adapter that applies only **declared, hashed** transformations
(`adapter.mjs`), an **adapter validation contract** (`contract.mjs` — raw/
normalized hashes, reproducible transformations, no truth leaked into estimator
input), **dataset eligibility** (`eligibility.mjs` → `EVIDENCE_INELIGIBLE`),
subject/session **split protection**, and an **external maturity ladder**
(`maturity.mjs`: `E1-EXTERNAL-REPLAY` … `E3-CROSS-DATASET`, `H1`, `H2`) that the
autonomous loop **cannot self-advance** — every external level requires
human-gated provenance, so the loop can only prepare evidence and escalate
`NEEDS_EXTERNAL_DATASET`. `E3` requires two independently acquired datasets so one
small dataset cannot cause a large maturity jump. No real dataset is fabricated;
a labelled synthetic fixture (`fixture.mjs`) self-tests the plumbing, and a real
dataset is a human drop-in under `evidence/external/`.

## The loop

```
claims + evidence ledger
  -> find highest uncertainty            (selector, expected information gain)
  -> design cross-world experiment       (per-step, one world at a time)
  -> preregister protocol                (hash-frozen BEFORE execution)
  -> execute in isolation                (hidden challenge + ground truth)
  -> analyse vs frozen criteria          (statistician; abstention is primary)
  -> independent red-team review         (adversarial critic)
  -> reproduce from raw inputs           (reproducer; exact hash compare)
  -> resolve step by cross-world quorum  (advance / falsify / escalate)
  -> ...
```

## Quick start

```bash
npm run lab:test                 # offline smoke test (43 assertions)
npm run lab:test:mutation        # governance mutation test (all guardrails killed)
npm run lab:test:cross-world     # proof: expose + reject an overfit estimator
npm run lab:test:external        # external-evidence framework + evaluation outcomes (26 assertions)

npm run lab -- seed              # seed the ledger from registry/claims/
npm run lab -- plan              # ranked next experiments (expected info gain)
npm run lab:run                  # run the loop to a terminal state
npm run lab:status               # ledger + experiment summary
npm run lab:diversity            # campaign diversity report
npm run lab -- candidates <claim_id>       # co-equal multi-candidate evaluation
npm run lab -- brief <claim_id> [--json]   # one-decision escalation brief
npm run lab -- receipt <exp_id>            # signed receipt + signature check
npm run lab -- reproduce <exp_id>          # rerun from the frozen protocol
```

A run resolves each seeded claim to a terminal state and prints the escalations.
With the default claims it climbs three claims to the C5 hardware ceiling,
**falsifies** the second-person claim (the ensemble misattributes on the
biomechanical intruder world), and raises **NEEDS_NEW_SIMULATOR** for the
clock-sync claim (no world models it yet).

## Bounded roles (deterministic modules)

| Role | Module | Prohibited action (enforced) |
| --- | --- | --- |
| Experiment Designer | `lib/selector.mjs` | cannot execute before prereg; blind to hidden challenge manifests |
| Protocol Auditor | `lib/prereg.mjs` (`protocolIntact`) | cannot rewrite thresholds after results — edits break the freeze hash |
| Executor | `lib/executor.mjs` | cannot interpret significance; sole reader of hidden truth; no leakage |
| Statistician | `lib/statistician.mjs` | cannot drop cases; scores every trial |
| Adversarial Critic | `lib/critic.mjs` | cannot modify results; only appends findings + downgrades the verdict |
| Reproducer | `lib/reproducer.mjs` | cannot use cached outputs; regenerates from seeds |
| Governor | `lib/governor.mjs` | cannot approve expenditure, breach C5, or waive a hard constraint |

## Maturity ladder + hard ceiling (`lib/maturity.mjs`)

`C0` proposed · `C1` plausible · `C2` external evidence · `C3` independent-data
reproduction · `C4` adversarial simulation · **`C5` hardware experiment required
(autonomous ceiling)** · `C6` bench · `C7` human observational · `C8` clinical.
The governor **permanently forbids** advancing past `C5`, and records any attempt
as an `unsupported_promotion_attempt` (itself a hard-constraint violation).

## Two-stage advancement gate (`lib/constraints.mjs`)

A weighted utility can hide a dangerous failure mode. So advancement is gated in
two stages: **hard safety constraints must ALL pass first**, and only then does
utility rank candidates.

```
false_confident_rate            <= 0.001
target_absent_false_positive    <= 0.001
reproduction_status              == EXACT_MATCH
protocol_tamper_events           == 0
unsupported_promotion_attempts   == 0
critical_scenario_coverage      >= 1.0   (all required world families)
```

Abstention is a primary metric (`lib/statistician.mjs`), and the frozen utility
`ValidCoverage − 5·FalseConfident − 2·MissedAbstention` penalizes dangerous
confidence far more heavily than an unavailable reading.

## Blind challenges + provenance

- **Blind challenges** (`lib/challenges.mjs`): the selector sees a challenge set
  by id and coarse metadata only; the per-seed perturbation schedule and truth
  annotations are readable **only by the executor**, which reveals truth to the
  statistician at scoring time.
- **Evidence provenance** (`lib/provenance.mjs`, `evidence/`): every result
  carries a provenance class. Only `simulated` evidence is produced
  autonomously; `public_dataset`, `recorded_hardware`, `manually_labelled` and
  `third_party_reproduction` are human-gated adapters, each with its own ingest
  escalation. A claim never advances on simulator evidence pretending to be
  external validity.

## Escalation (`lib/escalation.mjs`)

Everything the loop cannot resolve autonomously reduces to ONE decision in one
category — `NEEDS_NEW_SIMULATOR`, `NEEDS_EXTERNAL_DATASET`, `NEEDS_HARDWARE`,
`NEEDS_HUMAN_LABELS`, `NEEDS_CLINICAL_REVIEW`, `CLAIM_FALSIFIED`,
`SOFTWARE_CEILING_REACHED` — with a compact machine digest (`brief --json`) and a
human decision brief (`brief`).

## Receipts (`lib/receipts.mjs`)

Every completed run produces an ed25519-signed receipt: protocol hash, runner
version, input manifest hash, world + challenge + candidate, timings, PASS/FAIL
against frozen criteria, red-team verdict, reproduction status. Any later edit
breaks the signature.

## Layout

```
research_lab/
  lab.mjs                     CLI: seed | status | plan | run | diversity | brief | receipt | reproduce
  registry/claims/            narrow, falsifiable seed claims with evidence plans
  policy/autonomy.json        hard autonomy boundaries + resource budgets
  evidence/                   provenance-classed evidence store (adapters for external data)
  lib/
    simulators/               world registry: sinusoidal, nonstationary, biomechanical, target_absent (each with a 2nd spatial channel)
    estimators/               fft_peak, autocorr, adaptive_motion_cancellation, robust_ensemble (v1/v2), sinusoid_template; frozen ensemble.config.json
    detectors/ambiguity.mjs   multi-target ambiguity gate (observational independence)
    external/                 external-evidence adapter, contract, eligibility, split protection, E-level maturity, fixture
    candidates.mjs            co-equal multi-candidate evaluation + pairwise disagreement
    dsp.mjs                   shared signal primitives (periodogram, autocorr, high-pass, imu-cancel)
    simulator_b.mjs           adversarial perturbation engine
    challenges.mjs            blind challenge sets (public metadata vs hidden manifest)
    statistician.mjs          metrics incl. abstention + target-absent FP + utility
    constraints.mjs           hard safety constraints (gate before utility)
    prereg.mjs                protocol build + freeze hash + tamper check
    selector.mjs              expected-information-gain, cross-world experiment selection
    critic.mjs                adversarial critic
    executor.mjs              isolated run vs frozen criteria (hidden truth, no leakage)
    reproducer.mjs            rerun from frozen protocol; hash compare
    governor.mjs              budgets, boundaries, C5 ceiling, hard-constraint gate, counters
    provenance.mjs            evidence provenance classes
    escalation.mjs            escalation categories + machine/human digests
    diversity.mjs             campaign diversity report
    receipts.mjs / store.mjs / ledger.mjs / rng.mjs / hash.mjs / maturity.mjs
  docs/RR-004-root-cause.md   documented root cause + informational-independence limit
  milestones/                 frozen milestone archives (receipts + summary + notes)
  evidence/external/          human-gated external evidence store (adapters, manifests, raw, normalized, labels)
  test/
    smoke.mjs                 offline end-to-end (41 assertions)
    mutation.mjs              governance mutation test (kills every guardrail mutant)
    cross_world.mjs           proof milestone: expose + reject an overfit estimator
    external.mjs              external-evidence framework (17 assertions)
  data/                       runtime state: keys, claims, protocols, receipts (git-ignored)
```

## Scope guardrails (pre-hardware phase)

- Software-only evidence; nothing advances past `C5`; no evidence advances a
  claim on a single world family.
- No hardware, no paid APIs, no human subjects, no private health data.
- Deterministic simulation and gates; a model may later *propose* hypotheses and
  draft protocols, but is never on the decision path.
- File-based store; the scientific record is plain, inspectable JSON on disk.

## What the current evidence proves — and does not

It proves the **control loop and its guardrails**: cross-world quorum, hard
safety constraints, protocol-freeze integrity, exact reproduction, separation of
duties, autonomy containment, and that an estimator overfit to one world is
exposed and rejected. It does **not** prove that the simulated signals reflect
real sensor physics, that any estimator works on real humans, or that the worlds
cover the dangerous confounders — those are exactly the boundaries the C5 ceiling
and the escalations report, and they require hardware and external data the loop
is forbidden to fabricate.
