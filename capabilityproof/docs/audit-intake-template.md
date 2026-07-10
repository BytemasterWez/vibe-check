# Dependency Intake Template

*Fill one of these per external dependency the prospect supplies. This is the
step that converts a vague API into a capability contract grounded in the
customer's actual use — "the USGS API works" is meaningless; the contract
below is the product.*

## Per-dependency intake

| Field | Answer |
| --- | --- |
| Source name | |
| Business task it supports | |
| What breaks (for customers/revenue) if it's wrong | |
| Expected update frequency | |
| Required fields | |
| Required geographic / entity coverage | |
| Acceptable data age | |
| Plausibility limits (value ranges, counts) | |
| Known fallback source (if any) | |
| How failures are detected today | |
| Last known incident (what, when, how found) | |
| Estimated manual cost of the last incident (hours) | |

## Worked example: from intake to contract

Intake answers for a hazard-alerting product using the USGS feed:

> Task: retrieve earthquakes of magnitude 2.5+ in the contiguous US.
> Data must be under 10 minutes old, event ids unique, magnitudes numeric
> and plausible, coordinates valid, no gaps in the coverage window.

Becomes a versioned contract:

```json
{
  "id": "customer_x.usgs_m25_conus",
  "contract_version": "1.0.0",
  "request": { "method": "GET", "url": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson" },
  "checks": [
    { "type": "status", "equals": 200 },
    { "type": "json" },
    { "type": "freshness", "path": "metadata.generated", "unit": "epoch_ms", "max_age_hours": 0.17 },
    { "type": "min_rows", "path": "features", "min": 1 },
    { "type": "unique_field", "path": "features", "field": "id" },
    { "type": "fields_present", "path": "features", "fields": ["id", "properties.mag", "properties.time", "geometry.coordinates"] },
    { "type": "value_range", "path": "features", "field": "properties.mag", "min": 2.5, "max": 10 }
  ]
}
```

Every requirement in the contract must trace back to an intake answer. If a
requirement can't be expressed as a check yet, that is a product gap to log —
one of the three sanctioned reasons to write code.

## The findings report must quantify money and exposure

Technical observations alone don't renew. Translate the 14 days into:

- number of silent failures (passed HTTP, failed the contract)
- total degraded hours, and longest single incident
- stale responses / schema changes / incomplete responses (counts)
- incidents their existing monitoring would **not** have caught
- fallback readiness: does a viable, contract-passing alternative exist?
- estimated engineering hours of diagnosis avoided
- recovery-time improvement with alerts + verified fallback

Report skeleton:

```
During the 14-day audit:
- N sources monitored, M verification runs
- X contract failures detected, Y of which passed ordinary HTTP monitoring
- Longest incident: … (dimension: …)
- Fallback status per source: …
- Estimated manual diagnosis avoided: …–… engineering hours
```

## The 30-contact experiment (three rounds of ten)

**Round 1 — discovery (10 contacts).** No selling. Ask: which external
sources do you rely on; how do you detect bad or stale responses today; tell
me about your last externally-caused data incident; how long did diagnosis
take; do you keep fallbacks; what would you need to trust one?
*Pass: 3 substantive replies, 2 conversations, 1 dependency list. Extract
their vocabulary for round 2.*

**Round 2 — refined offers (10 contacts).** Rewrite the pitch in the words
heard in round 1. Offer one free design-partner audit where strategic,
otherwise a £250 pilot: 3–5 sources, 14 days, no commitment.
*Pass: 2 accepted audits; 1 prospect providing real endpoints and
requirements.*

**Round 3 — paid proposals (10 contacts).** Use evidence from the first
audits. £750 for 3–5 simple sources; £1,000–£1,500 for 6–10 or complex
contracts; £250–£750/month continuing monitoring.
*Pass: 1 paid audit or 1 continuing-monitoring customer; ideally 1
resolver/SDK integration.*

**Validation ladder** (claim only the rung you've reached): problem
confirmed → dependencies supplied → detection valued → payment → integration
→ retention. Interest only in reports means: sell managed monitoring first.

## Development freeze rules

New code requires one of exactly three justifications:

1. a prospect's dependency cannot currently be tested;
2. a prospect needs a specific integration format;
3. a live audit exposes a verification weakness.

Everything else is backlog. The next milestone is not source 27 — it is
prospect number one supplying a dependency list.
