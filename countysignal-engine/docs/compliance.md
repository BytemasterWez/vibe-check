# Compliance

## Access policy

1. **No scraping unless the source's terms explicitly permit it.** The
   contract model rejects scraping access methods without
   `scraping_allowed: true`, and none of the shipped contracts allow it.
2. Preferred access, in order: official APIs, official bulk downloads,
   official extracts, clearly-permitted open data portals.
3. Upstream rate limits are respected (retry with exponential backoff,
   adapter-level throttles); the fetch User-Agent identifies the pipeline.
4. API keys for upstreams (Census, BLS) come from environment variables
   only — never from contracts, code, or the database.

## Licensing & attribution

Every contract carries `licence_status` and `attribution`; both are stored
in `registry.licence_terms` and travel with every raw artifact
(`raw.files.licence_status`). Milestone 1 sources are U.S. federal
government data (public domain, attribution requested):

| Source | Licence | Attribution |
|---|---|---|
| BLS LAUS | public_government_data | U.S. Bureau of Labor Statistics, Local Area Unemployment Statistics |
| Census ACS | public_government_data | U.S. Census Bureau, American Community Survey 5-Year Estimates |
| FEMA NRI | public_government_data | FEMA National Risk Index |

Commercial sources added later (e.g. Zillow, Realtor.com research data)
must have their redistribution terms reviewed and recorded in
`registry.licence_terms` **before** `production_allowed: true` is set, and
their attribution surfaced in API responses/exports where required.

## Customer-facing posture

- Customers never touch raw tables; only versioned `api.*` views through
  the read-only role.
- Exports carry provenance (`evidence_json`), source attribution and the
  model version that produced each score.
- `audit.api_usage` retains hashed keys only — API keys are never persisted.
- Every published number is rebuildable from the contract hash, ingestion
  run and raw artifact hash recorded alongside it.

## Data subjects

The engine stores **county-level aggregates only**. No personal data, no
microdata. Sources that publish suppressed cells (Census sentinels, QCEW
disclosure suppression) are normalised to `NULL`, never imputed silently.
