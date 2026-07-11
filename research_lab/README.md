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
npm run lab:test                 # offline smoke test (34 assertions)
npm run lab:test:mutation        # governance mutation test (all guardrails killed)
npm run lab:test:cross-world     # proof: expose + reject an overfit estimator

npm run lab -- seed              # seed the ledger from registry/claims/
npm run lab -- plan              # ranked next experiments (expected info gain)
npm run lab:run                  # run the loop to a terminal state
npm run lab:status               # ledger + experiment summary
npm run lab:diversity            # campaign diversity report
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
    simulators/               world registry: sinusoidal, nonstationary, biomechanical, target_absent
    estimators/               fft_peak, autocorr, adaptive_motion_cancellation, robust_ensemble, sinusoid_template
    dsp.mjs                   shared signal primitives (periodogram, autocorr, high-pass)
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
  test/
    smoke.mjs                 offline end-to-end (34 assertions)
    mutation.mjs              governance mutation test (kills every guardrail mutant)
    cross_world.mjs           proof milestone: expose + reject an overfit estimator
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
