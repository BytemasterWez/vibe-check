# Source Verification Report

Generated: 2026-07-07T14:08:56.927985+00:00

| Source | Status | Regressed | Notes |
|--------|--------|-----------|-------|
| U.S. Courts Bankruptcy Unclaimed Funds Locator (`bankruptcy_ucfl`) | UNKNOWN | — | All probes denied by this runner's egress policy (proxy CONNECT 403). The source itself is UNTESTED — re-run jobs/verify_sources.py from an environment with network access to these hosts before any ingestion. |
| GSA Real Property Disposition / RealEstateSales.gov (`gsa_real_property`) | UNKNOWN | — | All probes denied by this runner's egress policy (proxy CONNECT 403). The source itself is UNTESTED — re-run jobs/verify_sources.py from an environment with network access to these hosts before any ingestion. |
| GSA Auctions API (personal property; real-property coverage TBD) (`gsa_auctions_api`) | UNKNOWN | — | All probes denied by this runner's egress policy (proxy CONNECT 403). The source itself is UNTESTED — re-run jobs/verify_sources.py from an environment with network access to these hosts before any ingestion. |
| Treasury (TEOAF) Seized Real Property Auctions (`treasury_seized_rp`) | UNKNOWN | — | All probes denied by this runner's egress policy (proxy CONNECT 403). The source itself is UNTESTED — re-run jobs/verify_sources.py from an environment with network access to these hosts before any ingestion. |
| USMS Forfeited Real Property Sales (`usms_forfeited_rp`) | UNKNOWN | — | All probes denied by this runner's egress policy (proxy CONNECT 403). The source itself is UNTESTED — re-run jobs/verify_sources.py from an environment with network access to these hosts before any ingestion. |
| FEMA National Flood Hazard Layer (NFHL) ArcGIS services (`fema_nfhl`) | UNKNOWN | — | All probes denied by this runner's egress policy (proxy CONNECT 403). The source itself is UNTESTED — re-run jobs/verify_sources.py from an environment with network access to these hosts before any ingestion. |
| HUD/CDFI Qualified Opportunity Zones (census tracts) (`hud_opportunity_zones`) | UNKNOWN | — | All probes denied by this runner's egress policy (proxy CONNECT 403). The source itself is UNTESTED — re-run jobs/verify_sources.py from an environment with network access to these hosts before any ingestion. |
| U.S. Census Bureau Geocoder (`census_geocoder`) | UNKNOWN | — | All probes denied by this runner's egress policy (proxy CONNECT 403). The source itself is UNTESTED — re-run jobs/verify_sources.py from an environment with network access to these hosts before any ingestion. |
| SEC EDGAR full-text search & company API (`sec_edgar`) | UNKNOWN | — | All probes denied by this runner's egress policy (proxy CONNECT 403). The source itself is UNTESTED — re-run jobs/verify_sources.py from an environment with network access to these hosts before any ingestion. |
| OpenCorporates API (`opencorporates`) | UNKNOWN | — | All probes denied by this runner's egress policy (proxy CONNECT 403). The source itself is UNTESTED — re-run jobs/verify_sources.py from an environment with network access to these hosts before any ingestion. |

Statuses beginning `VERIFIED_` are production-eligible; `UNKNOWN` sources are untested (often runner-side network policy); `BLOCKED` sources must not be crawled.
