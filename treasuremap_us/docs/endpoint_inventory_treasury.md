# Endpoint Inventory — Treasury (TEOAF) Seized Real Property Auctions

Source id: `treasury_seized_rp` · Engine 2 · PHASE 1

## Verification state (2026-07-07)

**UNKNOWN — untested.** Probes denied by the runner's egress policy
(proxy CONNECT 403). Runner-side block; source behaviour unknown.
Record: `data/source_verification/treasury_seized_rp.json`.

## Known endpoints (research, unverified)

| Endpoint | Method | Notes |
|----------|--------|-------|
| `https://www.treasury.gov/auctions/treasury/rp/` | GET | Seized real property auction index (legacy static `.shtml` pages) |
| `https://www.treasury.gov/auctions/treasury/rp/about.shtml` | GET | Programme description |
| `https://www.treasury.gov/auctions/treasury/rp/faqs2.shtml` | GET | FAQ (bidding mechanics) |
| `https://www.treasury.gov/auctions/treasury/gp/` | GET | General (personal) property auctions — adjacent source |
| `https://cwsmarketing.com/auctions/real-estate/` | GET | Prime contractor CWS Asset Management & Sales — live listing detail (WordPress) |

## Documented facts

- TEOAF advertises residential, commercial, land, warehouse and operating
  business properties seized/forfeited under federal law, across the U.S.
  and Puerto Rico.
- CWSAMS is the prime contractor for maintenance and sale; states listings
  are free to access with no fee to attend.
- Auction mechanics: open to the public; register with photo ID +
  cashier's-check deposit; **no buyer's premium**; payment in full at
  closing, typically within 45 days.

## Expected status after verification

`VERIFIED_HTML_INDEX` — legacy static pages plus a conventional contractor
site suggest crawl-friendly HTML, subject to robots.txt on both hosts.

## Verification checklist

1. `python jobs/verify_sources.py`.
2. Capture the RP index page; validate `parse_index()` heuristics in
   `adapters/treasury_seized_property_adapter.py` against real markup.
3. Check robots.txt on both treasury.gov and cwsmarketing.com; record.
4. Confirm listing lifecycle (how sold/closed listings disappear) to
   design the weekly diff.
