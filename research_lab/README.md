# Autonomous Pre-Hardware Sensing Laboratory

A closed, deterministic research loop that automates the *pre-hardware* science
of a clinical sensing capability: it maintains a machine-readable claim ledger,
finds the highest-uncertainty claim, designs and **preregisters** a falsification
experiment, executes it in isolation against **frozen** acceptance criteria,
red-teams and reproduces the result, and advances claim maturity — **never past
the pre-hardware ceiling (C5)**.

The deliverable is not a scanner. It is a defensible map of *what is observable,
under which conditions, with what evidence* — and the smallest set of physical
experiments still required. Your attention is needed only at governance gates,
not during routine experimentation.

Like the rest of this repo, it is zero-dependency Node (`node:crypto` only),
file-based, and deterministic: every gate decision is code, not a model call.

## The loop

```
claims + evidence ledger
  -> find highest uncertainty          (selector, by expected information gain)
  -> design falsification experiment   (per-family template)
  -> preregister protocol              (hash-frozen BEFORE execution)
  -> execute in isolated run           (hidden ground truth; no leakage)
  -> analyse vs frozen criteria        (statistician)
  -> independent red-team review       (adversarial critic)
  -> reproduce from raw inputs         (reproducer; hash compare)
  -> update claim maturity             (governor-gated, capped at C5)
  -> ...
```

It stops automatically at a terminal condition — all testable claims resolved,
the pre-hardware evidence ceiling reached, a fatal contradiction, exhausted
data, a resource limit, or something requiring a human decision.

## Quick start

```bash
npm run lab:test            # offline end-to-end test (26 assertions)

npm run lab -- seed         # seed the ledger from registry/claims/
npm run lab -- plan         # ranked next experiments (expected information gain)
npm run lab:run             # run the loop to a terminal state
npm run lab:status          # ledger + experiment summary
npm run lab -- receipt   <experiment_id>   # signed receipt + signature check
npm run lab -- reproduce <experiment_id>   # rerun from the frozen protocol
npm run lab -- digest    <claim_id>        # one-decision escalation digest
```

A run climbs each seed claim `C2 -> C3 -> C4 -> C5` and escalates when a claim
hits C5 (software ceiling; hardware required). Re-running resumes without
repeating completed work.

## Bounded roles (deterministic modules, not one general agent)

| Role | Module | Prohibited action (enforced) |
| --- | --- | --- |
| Experiment Designer | `lib/selector.mjs` | cannot execute before preregistration |
| Protocol Auditor | `lib/prereg.mjs` (`protocolIntact`) | cannot rewrite thresholds after results — edits break the freeze hash |
| Executor | `lib/executor.mjs` | cannot interpret clinical significance; only PASS/FAIL vs frozen criteria |
| Statistician | `lib/statistician.mjs` | cannot drop cases; scores every trial |
| Adversarial Critic | `lib/critic.mjs` | cannot modify results; only appends findings + downgrades the verdict |
| Reproducer | `lib/reproducer.mjs` | cannot use cached outputs; regenerates from seeds |
| Governor | `lib/governor.mjs` | cannot approve expenditure or advance past C5 |

## The maturity ladder (`lib/maturity.mjs`)

`C0` proposed · `C1` plausible · `C2` external evidence · `C3` independent-data
reproduction · `C4` adversarial simulation · **`C5` hardware experiment
required (autonomous ceiling)** · `C6` bench · `C7` human observational · `C8`
clinical.

The governor **permanently forbids** advancing anything past `C5`. `C3` is
earned by an independent-data experiment; `C4` by surviving an adversarial
confounder campaign with correct abstention; `C5` is the escalation gate.

## Preregistration and frozen criteria (`lib/prereg.mjs`)

Before an experiment runs, the designer freezes a protocol — hypothesis, the
exact dataset (a manifest of simulator config + seeds, hashed), candidate vs
baseline, primary metric, acceptance thresholds, and failure conditions — and
hashes it. Ground truth is generated **after** the freeze, inside the executor,
and is never handed to the estimator. A failed experiment is **not** rerun with
easier thresholds: `protocolIntact` recomputes the freeze hash, so any
post-hoc edit is detected, and the reproducer recomputes from the same record.

## Two independent simulators

- **Simulator A** (`lib/simulator_a.mjs`) — mechanistic generator. Builds a
  thoracic-displacement signal from explicit physiological + sensor equations
  (respiration, cardiac, baseline wander, sensor noise) and emits a hidden
  ground-truth block.
- **Simulator B** (`lib/simulator_b.mjs`) — adversarial perturbation engine. It
  models no biology; it attacks a signal with named corruptions
  (`device_motion`, `second_person`, `sensor_dropout`, `gross_motion`) and marks
  whether the rate is still *recoverable*. Some corruptions are separable given
  the IMU channel; some are genuinely ambiguous and must be abstained on.

## Abstention is a primary metric (`lib/statistician.mjs`)

A measurement system with a low average error is still dangerous if it
occasionally reports confident nonsense. The statistician tracks numerical
error, coverage, false-confident-output rate, correct-abstention rate, and a
frozen engineering utility:

```
Utility = ValidCoverage - 5*(FalseConfidentRate) - 2*(MissedAbstentionRate)
```

Dangerous confidence is penalized far more heavily than an unavailable reading.

## Receipts (`lib/receipts.mjs`)

Every completed run produces a receipt — protocol hash, runner version, input
manifest hash, timings, primary metrics, PASS/FAIL against frozen criteria, the
red-team verdict, reproduction status, and the resulting claim effect — signed
with a locally generated ed25519 key (`data/keys/`, git-ignored). Any later edit
breaks the signature.

## Hard autonomy boundaries (`policy/autonomy.json`)

Forbidden and enforced by the governor: hardware purchase, paid API use,
contacting people, recruiting participants, diagnosing real patients, promoting
clinical claims, altering frozen thresholds, deleting failed results, using
private health data. Plus resource budgets (per-experiment runtime, disk floor,
mains-power requirement, consecutive-failure halt).

## When it escalates (blueprint §13)

A claim reaching C5, a fatal contradiction, exhausted data, or a repeated
failure without information gain halts the loop and produces a **one-decision**
digest (`lab.mjs digest <claim_id>`) — pre-hardware status, experiments
passed/failed, what's resolved, what's unresolved without hardware, the next
step that would cost money, and a recommendation. Not a sprawling report.

## Layout

```
research_lab/
  lab.mjs                     CLI: seed | status | plan | run | receipt | reproduce | digest
  registry/claims/            immutable seed claims (source of truth)
  policy/autonomy.json        hard autonomy boundaries + resource budgets
  lib/
    rng.mjs                   deterministic seeded RNG (no Math.random in the experiment path)
    hash.mjs                  canonical JSON + sha256 (freeze/evidence hashes)
    maturity.mjs              the C0..C8 ladder and the C5 ceiling
    simulator_a.mjs           mechanistic signal generator
    simulator_b.mjs           adversarial perturbation engine
    estimators.mjs            baseline + candidate RR estimators (with abstention)
    statistician.mjs          metrics incl. abstention + frozen utility
    prereg.mjs                protocol build + freeze hash + tamper check
    selector.mjs              expected-information-gain experiment selection
    critic.mjs                adversarial critic (confounders, alt explanations)
    executor.mjs              isolated run vs frozen criteria (no leakage)
    reproducer.mjs            rerun from frozen protocol; hash compare
    governor.mjs              budgets, boundaries, maturity ceiling
    receipts.mjs              ed25519-signed experiment receipts
    store.mjs                 file-based ledger/protocol/receipt store
    ledger.mjs                seeding + summaries + decision digest
    orchestrator.mjs          the closed loop
  test/smoke.mjs              offline end-to-end test
  data/                       runtime state: keys, claims, protocols, receipts (git-ignored)
```

## Scope guardrails (by design, pre-hardware phase)

- Software-only evidence; nothing advances past `C5`.
- No hardware, no paid APIs, no human subjects, no private health data.
- Deterministic simulation and gates; a model may later *propose* hypotheses and
  draft protocols, but it is never on the decision path.
- File-based store; the scientific record is plain, inspectable JSON on disk.
