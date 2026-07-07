# Source Limitations — V1 build (2026-07-07)

## The single blocking limitation

**This build environment cannot reach any external government host.**
Outbound HTTPS goes through an egress gateway that answered `403` to the
CONNECT for every probed host (uscourts.gov, gsa.gov, api.gsa.gov,
treasury.gov, usmarshals.gov, fema.gov, census.gov, sec.gov,
opencorporates.com). The block happens before any packet reaches the
origin, so **nothing is known about the sources' own behaviour** — no
CAPTCHA finding, no rate-limit finding, no markup capture.

Consequences, enforced by code:

1. Every source's effective status is `UNKNOWN` (see
   `data/source_verification/`).
2. Scoring applies the `-100 source_not_verified` penalty to every
   opportunity; **all decisions cap at PARK** — no SELL_CANDIDATE, no bid
   recommendation, no outreach-eligible lead can exist yet.
3. Ingestion refuses to run live (`NotCronSafe`); only labelled fixture
   runs (`--fixtures`) are possible, and every fixture card carries a
   DEMO banner.

## How to lift it

Run from any environment with ordinary outbound HTTPS (a $5 VPS, a home
machine, or this repo's environment with a permissive network policy):

```
cd treasuremap_us
pip install -r requirements.txt
python jobs/verify_sources.py
```

The verifier replay-tests each source, records honest statuses, and the
rest of the pipeline unlocks exactly as far as the recorded statuses
allow — nothing else needs to change.

## Per-source expectations once reachable

| Source | Expected best status | Fallback |
|--------|----------------------|----------|
| Bankruptcy UCFL | VERIFIED_SEARCH_FORM (polite seed queries) | per-court registers; VERIFIED_MANUAL_ONLY |
| GSA real property | VERIFIED_HTML_INDEX | VERIFIED_BROWSER_SESSION (Salesforce site) |
| GSA Auctions API | VERIFIED_API (free key) — real-property coverage TBD | n/a |
| Treasury TEOAF RP | VERIFIED_HTML_INDEX (legacy static pages) | contractor site (CWSAMS) |
| USMS forfeited RP | VERIFIED_HTML_INDEX via Bid4Assets storefront | VERIFIED_MANUAL_ONLY if ToS forbids crawling |
| FEMA NFHL | VERIFIED_API (keyless ArcGIS REST) | manual map lookup |
| Census geocoder | VERIFIED_API (keyless, batch CSV) | n/a |
| QOZ tract list | VERIFIED_DOWNLOAD (one-time; designations fixed) | n/a |
| SEC EDGAR | VERIFIED_API (keyless, declared UA required) | n/a |
| OpenCorporates | VERIFIED_PAID_API (licence required for commercial use) | state SoS manual lookups |

## Standing limitations independent of network access

- **UCFL has no bulk access**: even verified, it is a low-volume
  search-form source. Scale comes from seed-query breadth over weeks, not
  from crawling. Parser (`parse_results`) must be validated against a
  captured real page before production.
- **State SoS portals** (entity resolution) are mostly search forms or
  CAPTCHA-gated; V1 treats them as manual-lookup instructions inside
  evidence packs, not automated calls.
- **Recovery-fee law**: several states cap or condition unclaimed-property
  finder fees (see `config/states.yaml` notes for CA/NY/TX/FL). Any
  fee-based monetisation in a state requires a statute check first; the
  claim-card risk section carries this warning permanently.
- **No parcel/zoning national source**: county-by-county activation only.
- **PACER (court registry funds, PHASE 4)** is a paid API; budget design
  needed before activation.
