# External Data Dependency Reliability Audit

*The commercial validation offer — send this (adapted) to prospects. The goal
is not selling catalogue access; it is getting prospects to hand over the
sources their own product depends on.*

---

## The offer

**Give us 3–10 external APIs or public datasets your product relies on. We
will monitor them for 14 days and send you a report of every silent failure,
schema drift, stale response, partial result and missing fallback — with
evidence.**

Most teams that depend on external data discover breakage the same way:
a customer reports wrong output. Uptime monitors don't catch it because the
API still answers "200 OK" — with an error page, half the records, stale
numbers, or a quietly renamed field.

Our verification engine checks the *content*, not the connection. In
controlled benchmarks it detects 10/10 injected failure classes (truncation,
staleness, schema drift, duplicated rows, impossible values,
rate-limits-disguised-as-success, partial coverage, wrong data vintage,
broken join keys, HTML-in-a-200) with zero false positives.

## What you receive

- A **versioned verification contract** per dependency — explicit, reviewable
  assertions of what "working" means for your use of the source
- **Daily signed receipts** — tamper-evident, replayable evidence of each
  source's fitness, with per-dimension results (availability, completeness,
  schema, join keys, freshness)
- **Instant alerts** when a dependency starts failing or drifts
- A **14-day findings report**: incidents, durations, silent failures your
  current monitoring missed, and fallback recommendations

## Pricing (design-partner phase)

| Engagement | Price |
| --- | --- |
| First design partners (limited) | Free – £250 |
| Standard 14-day audit | £750 – £1,500 |
| Continuous monitoring pilot | £250 – £750 / month |
| Resolver API access (agents query before selecting a source) | usage-based, later |

## Who this is for

Teams whose revenue or output depends on external data they don't control:
AI-agent platforms, data-product consultancies, public-data intelligence,
automated research, location intelligence, vertical SaaS on government data.

## Validation thresholds (internal — after ~30 targeted contacts)

- 5+ meaningful calls → continue
- 3+ prospects hand over their dependency list → strong problem signal
- 1 paid audit → initial commercial validation
- 1 receipt/resolver integration → major technical validation
- Interest only in reports → sell managed monitoring first
- No calls → revise buyer and positioning before building anything else
