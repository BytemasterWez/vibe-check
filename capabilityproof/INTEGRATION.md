# Porting this morning's capabilities into Vigil

**Read this first — it is a specification, not a copy job.**

The code in `capabilityproof/` is **Node/JavaScript**. Vigil is **Python**
(pytest / httpx / Starlette), with a *judged membrane + audited record layer +
pluggable domain adapters + execution broker + red-team harness*. So these
files are the **reference implementation of three capabilities**; the Vigil
agent should **reimplement them in Python against Vigil's existing
abstractions**, reusing Vigil's own signing / record layer rather than porting
ours. Vigil already has overlapping machinery ("signed reports",
"artifact-chain integrity", "execution broker") — **reconcile, do not
duplicate.**

Source: repo `BytemasterWez/vibe-check`, branch
`claude/geospatial-hypothesis-engine-8cskng`, folder `capabilityproof/`.

---

## Capability 1 — Call attestation (per mediated call)

**Reference:** `lib/attestation.mjs` (`evaluateConformance`, `buildAttestation`,
verdict logic) + how `lib/service.mjs` `resolveAndFetch` calls it.

**What it is:** when the execution broker mediates a call, emit a signed record
that compares three things and judges conformance:

- **declared** — what the caller/agent said it wanted (e.g. the verbatim tool
  call).
- **approved** — what the membrane/policy actually allowed (the capability, the
  only fields the caller may influence, the locked host/path).
- **actual** — the exact request the broker sent and the response it got.

Then a **conformance dimension** of named checks (not one opaque score):
`param_scope` (caller only touched allowed fields), `host_locked` (actual
target == approved target), `envelope_match` (used the approved capability;
fallback disclosed), `result_valid` (response passed its own contract), and a
**tri-state verdict**:

- `conformant` — caller in-bounds **and** result valid.
- `out_of_envelope` — the **caller/agent** overstepped.
- `result_unverified` — the caller was in-bounds but the **downstream tool**
  misbehaved.

**Why it's the key delta:** Vigil already signs records; the genuinely new part
is (a) the conformance checks over declared-vs-approved-vs-actual and (b) the
verdict that **separates caller-fault from tool-fault**. That distinction is
what an auditor/insurer buys.

**Map onto Vigil:** emit this from the **execution broker** at the moment it
brokers a call; store it in the **audited record layer** next to Vigil's
signed reports; sign with **Vigil's existing signing**, not `signing.mjs`.

## Capability 2 — Agent readiness test (pre-deployment)

**Reference:** `lib/readiness.mjs` (`runReadinessTest`, `probeCapability`).

**What it is:** before an agent is deployed, exercise its *declared operating
envelope* (the capabilities/adapters it will use, under a named policy) against
a guardrail battery — inject an undeclared parameter (must be caught as
`out_of_envelope`), point it at a degraded source (must not be blessed
`conformant`) — and issue a **signed readiness certificate**: green / amber /
red capabilities, residual risks, authority ceiling (the policy), and a
`readiness_score` = fraction of guardrail checks that held.

**Map onto Vigil:** this is a natural extension of Vigil's existing
**red-team harness** — fold it in there rather than adding a parallel system.
Output a signed certificate through the audited record layer.

## Capability 3 — Behavioural reconciliation (whole-session)

**Reference:** `lib/reconcile.mjs` (`reconcileBehavior`).

**What it is:** the call attestation only proves the *sanctioned channel*
(calls the broker mediated). This reconciles a set of effects an **external
monitor observed** (network hosts / files / processes, e.g. from a kernel
monitor the customer runs) against the session's sanctioned calls, and signs a
verdict flagging **unaccounted activity** (a host or file no sanctioned call
touched).

**Honest boundary — keep it on the record:** Vigil **reconciles and signs**; it
does **not** capture kernel activity itself. State this provenance on every
reconciliation, exactly as the reference does.

**Map onto Vigil:** an audited-record-layer function that takes the session's
attestation records + a caller-supplied observation set and produces a signed
reconciliation.

---

## What the Vigil agent should actually do

1. **Inventory first.** Find Vigil's execution broker, its signed-report /
   artifact-chain code, its policy release/rollback, and its red-team harness.
   Decide, per capability above, whether Vigil already does it, partly does it,
   or lacks it.
2. **Reuse Vigil's primitives.** Signing, record storage, policy versioning —
   use Vigil's, not ours. `signing.mjs` is only a reference for the shape.
3. **Implement the deltas in Python**, with tests in Vigil's suite:
   - broker emits conformance-checked, tri-state-verdict attestations;
   - red-team harness gains the readiness-certificate mode;
   - record layer gains behavioural reconciliation.
4. **Do not import or transpile the `.mjs` files.** They are the spec and the
   test oracle (see `test/smoke.mjs` for the exact assertions each capability
   must satisfy — 8 relevant ones: signed conformant attestation, replay,
   out-of-envelope param, tamper-evidence, readiness bucketing + signature,
   reconciliation clean + unaccounted).

## Test oracle

`capabilityproof/test/smoke.mjs` contains the behavioural assertions the Python
port must reproduce. Mirror them as pytest cases in Vigil so the ported
capabilities are proven to the same standard as the reference.
