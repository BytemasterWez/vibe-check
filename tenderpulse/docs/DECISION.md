# Red-Team Review & Decision Gate (Phases 10, 14)

## Red-team risk review

| Risk | Severity | Likelihood | Mitigation | Affects decision? |
|---|---|---|---|---|
| False positives (junk matches) | MED | MED | word-boundary keywords (fixed during build — "IT" no longer matches "Insulin"), CPV weighting dominates, per-customer tuning in pilot | IMPROVE lever, not a blocker |
| False negatives (missed tenders) | HIGH | LOW–MED | both official feeds ingested; overlap windows; freshness monitoring; promise scoped to "both official portals", not "everything on earth" | priced into promise |
| Data hallucination | LOW | LOW | LLM optional + summary-only + constrained to digest facts; every claim carries deterministic evidence link | no |
| Source outage / policy change | MED | LOW | statutory publication channels (Procurement Act 2023); retry/backoff; safe-mode serving last-known-good; bulk-download fallback exists | no |
| Weak differentiation vs Stotles/Tenders Direct | HIGH | MED | wedge = explainable scoring + SME price + consultant white-label; verticalise fast; competitors validate budget | main SELL risk — tested by the 30-day outreach gates |
| Weak buyer urgency in sparse niches | MED | MED | qualification rule: ≥5 relevant notices/month before pitching; refund + exit sparse pilots | churn control |
| Over-automation | LOW | LOW | manual wedge first; outreach never auto-sent | no |
| Cost overrun | LOW | LOW | ≤£20/mo infra; LLM hard cap in code | no |
| Legal/privacy | LOW | LOW | OGL v3 open data; only officially published buyer contact points stored, excluded from exports; no scraping | no |
| Support burden | MED | MED | digest-quality tuning is the product's real labour; cap = 30 min/customer/week gate | scaling lever |
| LLM dependency | LOW | LOW | fully optional by design | no |

## Decision gate

Scoring against the SELL threshold: buyer clear ✅ (SME bid leads + bid
consultants, titles named) · pain clear ✅ (missed tenders, hard deadlines,
portal noise) · first paid offer clear ✅ (£99/30-day pilot) · useful output
generated ✅ (live scored digest produced from production data during this
build) · source reliability ✅ (two official APIs, PASS on all verdicts) ·
ingestion/normalisation workable ✅ (40 passing tests incl. end-to-end on
real fixtures; idempotent reruns) · cloud cost acceptable ✅ (≤£20/mo) ·
LLM cost acceptable ✅ (optional, capped) · legal risk acceptable ✅ (OGL v3)
· outreach package ready ✅.

## DECISION: **SELL** — with one honest caveat

The system is buildable (built), the data is reliable (verified live), the
economics are excellent (break-even at one customer), and the downside is LOW
(≤£30 cash at 90 days, reusable OCDS infrastructure either way). The single
unproven claim is **differentiation-at-price against incumbents** — that is a
market question no amount of building answers. So: do **not** build more.
Run the 30-day buyer-evidence plan (50 contacts, thresholds in
`COMMERCIAL.md`). Hit the gates → scale to Core subscriptions and build the
award/renewal-intelligence upsell (idea #2) on this same pipeline. Miss the
gates → PARK the product, keep the connectors/schema/scoring as reusable
assets, and re-aim them at idea #2's higher-value buyer.
