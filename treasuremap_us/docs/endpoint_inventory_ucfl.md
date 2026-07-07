# Endpoint Inventory — U.S. Courts Bankruptcy Unclaimed Funds Locator

Source id: `bankruptcy_ucfl` · Engine 1 (Claimable Funds) · PHASE 1

## Verification state (2026-07-07)

**UNKNOWN — untested.** All probes from this build environment were denied
by the runner's egress policy (proxy CONNECT 403 before any packet reached
the origin). This is a *runner-side* block: nothing is known yet about the
source's own behaviour (CAPTCHA, rate limits, markup). Re-run
`python jobs/verify_sources.py` from a network-open environment.
Verification record: `data/source_verification/bankruptcy_ucfl.json`.

## Known endpoints (research, unverified)

| Endpoint | Method | Notes |
|----------|--------|-------|
| `https://ucf.uscourts.gov/` | GET | Consolidated locator UI across participating bankruptcy courts |
| `https://ucf.uscourts.gov/about` | GET | Programme description |
| `https://ucf.uscourts.gov/?CreditorName={name}&SelectedCourts={court}` | GET | Query-string search observed in the wild (e.g. `?CreditorName=+vk&SelectedCourts=cacb`) — suggests the search form is GET-driven and deep-linkable |
| Per-court registers (e.g. `pamb.uscourts.gov/ucf`, `utb.uscourts.gov/unclaimed-funds-register`) | GET | Fallback for non-participating courts; formats vary (HTML tables, PDFs, XLS) |

## Documented facts

- No public API or bulk download is documented.
- Locator search supports creditor name, debtor name and court selection.
- Not all bankruptcy courts participate in the consolidated locator.
- Claim process: identify the case, then follow the *holding court's*
  procedure — typically AO Form 1340 (Application for Payment of Unclaimed
  Funds) with identity/entitlement documentation. Deposits governed by
  28 U.S.C. §2041–2042.

## Expected status after verification

`VERIFIED_SEARCH_FORM` (best case) — usable via the semi-manual seed-query
runner in `adapters/bankruptcy_ucf_adapter.py` at polite volume, never
bulk-crawled. If the form proves JS-only: `VERIFIED_BROWSER_SESSION`; if
CAPTCHA-gated: `BLOCKED` and per-court registers become the primary route.

## Verification checklist (network-open environment)

1. `python jobs/verify_sources.py` — confirms reachability + replay.
2. Manually capture one results page for a seed query; save to
   `data/raw/`; validate/adjust `parse_results()` against real markup.
3. Check `robots.txt` and any posted usage terms before enabling seed
   queries; record findings in the verification JSON `notes`.
4. Confirm result pagination behaviour and whether court codes are
   enumerable from the page (dropdown options).
