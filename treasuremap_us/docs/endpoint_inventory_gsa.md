# Endpoint Inventory — GSA Real Property Disposition / RealEstateSales.gov

Source ids: `gsa_real_property`, `gsa_auctions_api` · Engine 2 · PHASE 1

## Verification state (2026-07-07)

**UNKNOWN — untested.** All probes (including `api.gsa.gov` with
`DEMO_KEY`) denied by the runner's egress policy (proxy CONNECT 403).
Runner-side block; source behaviour unknown. Records:
`data/source_verification/gsa_real_property.json`, `gsa_auctions_api.json`.

## Known endpoints (research, unverified)

| Endpoint | Method | Notes |
|----------|--------|-------|
| `https://realestatesales.gov/` | GET | Public real-property sales portal |
| `https://disposal.gsa.gov/s/` | GET | Real Property Disposition site — Salesforce Experience Cloud (`/s/` path) |
| `https://disposal.gsa.gov/s/whatwesell` | GET | Programme scope page |
| `https://api.gsa.gov/assets/gsaauctions/v2/auctions?api_key={key}` | GET JSON/XML | **GSA Auctions API** (open data, api.data.gov key, free) — covers *personal* property; check whether real property appears. Docs: gsa.github.io/auctions_api |
| `https://catalog.data.gov/dataset/gsa-auctions-api` | GET | data.gov registration of the API |

## Documented facts

- GSA sells surplus federal real property by competitive public sale
  across the 50 states, DC, PR, USVI and Pacific territories.
- Sale methods include online auction and negotiated/sealed-bid routes.
- The Salesforce site renders listings client-side; the underlying aura
  data endpoints exist but **must pass a ToS review before use** — do not
  call them until that review is recorded in the verification JSON.

## Expected status after verification

- `gsa_auctions_api`: `VERIFIED_API` likely (documented public API with
  key) — but possibly not real property. Get a free api.data.gov key and
  set `GSA_API_KEY`.
- `gsa_real_property`: `VERIFIED_HTML_INDEX` if listing index pages are
  server-rendered; otherwise `VERIFIED_BROWSER_SESSION`.

## Verification checklist

1. `python jobs/verify_sources.py`.
2. Fetch the API with a real key; inspect whether any `real property`
   category exists; record in notes.
3. Capture one disposal.gsa.gov listing index + one detail page; decide
   HTML-index vs browser-session; write the real parser against captures.
4. Record robots.txt/ToS findings before any crawl.
