# Integrating this morning's work into Vigil

This documents how to amend the **Vigil** repo (the one with 300+ passing
tests) with the capabilities built this morning. It is written so the port is
mechanical: copy a self-contained folder, merge one dependency and a few
scripts, reconcile any overlap, run the tests.

## What was built this morning

Three capabilities, layered on the existing CapabilityProof engine, all in the
agent tool-calling loop:

1. **Call attestations** — a signed, replayable record of a single tool call
   made through the resolver: what the agent *declared*, what the policy
   *approved*, the *exact* request sent, and whether it stayed in the approved
   envelope and returned valid data. Tri-state verdict: `conformant` /
   `out_of_envelope` (the agent overstepped) / `result_unverified` (the tool
   misbehaved). HTTP-layer, no kernel tracing.
2. **Agent readiness test** — exercises an agent's declared operating envelope
   (capabilities + policy) against a guardrail battery and issues a signed
   readiness certificate: green/amber/red capabilities, residual risks, and a
   readiness score.
3. **Behavioural reconciliation** — reconciles externally-observed effects
   (network/files/processes, e.g. from a kernel monitor the customer runs)
   against the session's sanctioned tool calls and signs the result, flagging
   unaccounted activity. Vigil reconciles and signs; it does **not** capture the
   observations (stated on every record).

## Self-containment (verified)

Nothing in `capabilityproof/` imports from outside that folder. The only
external npm dependency is `@modelcontextprotocol/sdk`; everything else is Node
built-ins (`crypto`, `fs`, `http`, `os`, `path`, `url`, `child_process`,
`readline`). Receipts, attestations, certificates and reconciliations are all
signed with a locally-generated ed25519 key created on first run.

## The amendment set (10 files under `capabilityproof/`)

New files:

| File | Purpose |
| --- | --- |
| `lib/attestation.mjs` | Conformance evaluation + build/sign/verify call attestations |
| `lib/readiness.mjs` | Agent readiness test → signed certificate |
| `lib/reconcile.mjs` | Reconcile observed effects vs sanctioned calls (signed) |
| `lib/signing.mjs` | Generic ed25519 signing shared by the new artifacts |

Edited files:

| File | What changed |
| --- | --- |
| `lib/service.mjs` | `resolveAndFetch` now emits an attestation; added `getAttestation`, `getAttestationEvidence`, `replayAttestation`, `readinessTest`, `getCertificate`, `reconcile`, `getReconciliation` |
| `lib/store.mjs` | Persist/retrieve attestations (`cpa_`), certificates (`cert_`), reconciliations (`rec_`) |
| `api.mjs` | New routes (see below) + `declared` passthrough on resolve-and-fetch |
| `mcp-server.mjs` | New agent-facing tools (see below) |
| `test/smoke.mjs` | 8 new assertions (47 total, all passing offline) |
| `README.md` | Sections documenting all three capabilities with scope/provenance notes |

## How to port

1. **Locate Vigil's equivalent of `capabilityproof/`.** Vigil already gates
   actions and has a large test suite, so there may already be a
   verification/receipt/gating core. **Reconcile before copying — do not create
   a second overlapping layer.**
   - If Vigil has no such engine: copy the whole `capabilityproof/` folder in.
   - If Vigil already has receipts/resolver/policy: port only the four new
     `lib/*.mjs` files and graft the new `service.mjs` methods, `store.mjs`
     directories, `api.mjs` routes and `mcp-server.mjs` tools onto Vigil's
     existing equivalents. The new code depends only on: a `resolveAndFetch`
     that fills manifest placeholders, a deterministic check runner
     (`runChecks`), a `canonicalize` helper, an ed25519 keypair, and a
     file/db store. Map those to Vigil's names.

2. **Merge into Vigil's `package.json`:**
   - dependency: `"@modelcontextprotocol/sdk": "^1.29.0"` (skip if present)
   - scripts (adjust paths to Vigil's layout):
     `capabilityproof:test`, `:verify`, `:api`, `:mcp`, `:bench`, `:demo`

3. **New REST routes** (mirror onto Vigil's API):
   - `POST /v1/resolve-and-fetch` now returns `attestation` (+ `declared` input)
   - `GET  /v1/attestations/:id`, `/evidence`, `POST .../replay`
   - `POST /v1/readiness`, `GET /v1/readiness/:id`
   - `POST /v1/reconcile`, `GET /v1/reconcile/:id`

4. **New MCP tools** (mirror onto Vigil's MCP surface):
   `resolve_and_fetch`, `get_attestation`, `replay_attestation`,
   `agent_readiness_test`, `reconcile_behavior`.

5. **Run the tests.** `npm run capabilityproof:test` must stay green
   (47 assertions) alongside Vigil's existing 300+. Then wire the new tools
   into whatever Vigil integration/e2e suite exists.

## Reconciliation caution

Vigil is the source of truth. If Vigil already has an action-gating or
attestation concept, its naming and semantics win — this morning's code should
be adapted to Vigil's conventions, not the reverse. The goal is one clean
capability layer, not two.
