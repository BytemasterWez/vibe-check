# Endpoint Inventory — USMS Forfeited Real Property

Source id: `usms_forfeited_rp` · Engine 2 · PHASE 2 (verified from day 1)

## Verification state (2026-07-07)

**UNKNOWN — untested.** Probes denied by the runner's egress policy
(proxy CONNECT 403). Runner-side block; source behaviour unknown.
Record: `data/source_verification/usms_forfeited_rp.json`.

## Known endpoints (research, unverified)

| Endpoint | Method | Notes |
|----------|--------|-------|
| `https://www.usmarshals.gov/what-we-do/asset-forfeiture/real-property` | GET | Programme page |
| `https://www.usmarshals.gov/what-we-do/asset-forfeiture` | GET | Asset Forfeiture Division overview |
| `https://www.bid4assets.com/storefront/usms` | GET | Contractor storefront hosting live USMS online auctions |

## Documented facts

- USMS manages and disposes of legally forfeited assets including real
  estate and commercial businesses.
- Public online auctions run largely through the Bid4Assets USMS
  storefront; other contractors are authorised by property type/region.
- Bid4Assets requires an account to **bid**; whether listing **browsing**
  works without a session must be verified. Never create accounts or
  sessions programmatically.

## Expected status after verification

`VERIFIED_HTML_INDEX` (best case, storefront browsable), else
`VERIFIED_BROWSER_SESSION` or `VERIFIED_MANUAL_ONLY`.

## Verification checklist

1. `python jobs/verify_sources.py`.
2. Determine whether the storefront listing grid is server-rendered.
3. Check Bid4Assets ToS for automated-access language **before** any
   crawl; record verdict in the verification JSON notes.
4. If ToS prohibits crawling: mark `VERIFIED_MANUAL_ONLY` and rely on the
   USMS page + manual weekly review.
