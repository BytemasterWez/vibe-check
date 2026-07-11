# High-Value 50 Expansion — Completion Report

*One-time curated catalogue expansion, executed 2026-07-11 under a narrow,
explicit override of the development freeze. This batch is now closed: no
further candidates will be added without a new explicit instruction. The
trust policy was not weakened; nothing was auto-promoted past quarantine.*

## Headline tallies

| Metric | Count |
| --- | --- |
| Candidates attempted | 50 |
| Duplicates removed (provider/base-URL/dataset identity) | 11 |
| Rejected before probing (no viable recurring-testable API) | 6 |
| Live-probed keyless candidates | 14 |
| → Working, contract drafted, receipt minted, quarantined | 13 |
| → Failed from test location (retry on deployment) | 1 (CFPB — persistent timeout via cloud proxy; endpoint returns HTTP 200) |
| Parked awaiting free credentials (auto-activate when env var set) | 19 |
| Admission scores | all admitted candidates 70–92 / 100 |
| Auto-promotions past experimental | 0 (as mandated) |

Catalogue trajectory: 26 trusted + 13 in quarantine + 19 parked = **58
capabilities registered or staged**, against the ~70 target once credentials
are added.

## Duplicates removed (already in the trusted catalogue)

US Census Data API, Census Geocoding API, BLS API, Treasury Fiscal Data API,
USAspending API, FEMA OpenFEMA API, USGS Earthquake API, National Weather
Service API, USGS Water Services API, FCC API, openFDA API.

## Now in quarantine (streak required before experimental tier)

| Capability | Score | First verification | Latency |
| --- | --- | --- | --- |
| `source.fdic.bankfind_institutions` | 85 | verified 5/5 | 368ms |
| `source.federalregister.documents` | 88 | verified 5/5 | 175ms |
| `source.ncei.daily_summaries` | 85 | verified 5/5 | 491ms |
| `source.grantsgov.opportunity_search` (POST) | 84 | verified 5/5 | 206ms |
| `source.nhtsa.vehicle_recalls` | 84 | verified 5/5 | 82ms |
| `source.cms.hospital_provider_data` | 83 | verified 4/4 | 120ms |
| `source.nhtsa.vpic_vehicle_makes` | 81 | verified 5/5 | 1300ms |
| `source.fema.nfhl_flood_layers` | 81 | **failed — upstream 504** | 10068ms |
| `source.cdc.places_local_health` | 81 | verified 5/5 (2nd attempt; 1st timed out) | 232ms |
| `source.epa.envirofacts_tri` | 78 | verified 5/5 | 2997ms |
| `source.usgs.tnm_products` | 77 | verified 5/5 | 685ms |
| `source.epa.echo_facilities` | 76 | verified 5/5 (after narrowing query — first response exceeded the 5MB probe cap) | 221ms |
| `source.cftc.public_reporting` | 74 | verified 5/5 | 265ms |

Findings worth noting, since they are the product working:

- **FEMA NFHL returned HTTP 504 between two probes minutes apart** — a
  genuinely flaky upstream. Its streak is 0/3; quarantine will decide.
- **EPA ECHO's default query returned 7.9MB**, breaching the probe's safety
  cap; the contract now uses a bounded query (`responseset=50`).
- **CFPB's complaints API times out (>30s) from this cloud location while
  returning HTTP 200 headers** — the candidate is retained and will be
  retried automatically from the production deployment.

## Parked — activate by setting one environment variable each

| Capability | Score | Set this to activate |
| --- | --- | --- |
| `source.fred.series_observations` | 92 | `FRED_API_KEY` (free) |
| `source.sec.edgar_submissions` | 91 | `SEC_CONTACT_EMAIL` (SEC requires a real contact email in the request identity; verified working 2026-07-11) |
| `source.sec.company_facts` | 90 | `SEC_CONTACT_EMAIL` |
| `source.eia.electricity_retail_sales` | 86 | `EIA_API_KEY` (free) |
| `source.bea.nipa_data` | 84 | `BEA_API_KEY` (free) |
| `source.regulationsgov.documents` | 82 | `REGULATIONS_GOV_API_KEY` (free) |
| `source.samgov.contract_opportunities` | 81 | `SAM_GOV_API_KEY` (free) |
| `source.noaa.climate_data_online` | 79 | `NOAA_CDO_TOKEN` (free) |
| `source.hud.fair_market_rents` | 79 | `HUD_API_TOKEN` (free) |
| `source.epa.airnow_current_aqi` | 78 | `AIRNOW_API_KEY` (free) |
| `source.census.building_permits` | 78 | `CENSUS_API_KEY` (already planned) |
| `source.usda.nass_quick_stats` | 77 | `NASS_API_KEY` (free) |
| `source.uspto.patent_search` | 76 | `USPTO_API_KEY` (free) |
| `source.usda.fooddata_central` | 75 | `FDC_API_KEY` (free) |
| `source.nrel.alt_fuel_stations` | 74 | `NREL_API_KEY` (free) |
| `source.trade.consolidated_screening_list` | 73 | `TRADE_GOV_API_KEY` (free) |
| `source.gsa.auctions` | 71 | `GSA_API_KEY` (free) |
| `source.transitland.feeds` | 71 | `TRANSITLAND_API_KEY` (free) |
| `source.gsa.city_pair_fares` | 70 | `GSA_API_KEY` |

Parked candidates run through the identical pipeline (probe → draft →
quarantine → streak → experimental → human approval) the moment their
variable exists. Endpoint URLs for parked entries are best-effort and are
re-validated live on activation; a wrong guess fails the probe and is
discarded with evidence, never admitted.

## Rejected (with reasons)

| Candidate | Reason |
| --- | --- |
| IRS tax statistics | Bulk statistical files; no recurring-testable API |
| SBA Open Data API | Legacy api.sba.gov deprecated; no stable successor |
| DOE Open Data API | No distinct stable API beyond keyed NREL/OpenEI |
| BTS API | No stable public dataset identifier confirmed this pass |
| FAA data APIs | Public airport-status API discontinued; NOTAM API access-restricted |
| FRA safety data | Portal downloads only; no API |

## Authentication census (new batch)

- No auth: 14 candidates (13 quarantined + CFPB pending retry)
- Free API key: 15
- Free token/bearer header: 2 (NOAA CDO, HUD)
- Contact-identity User-Agent: 2 (SEC — no key, but a real email required)

## Licensing

All admitted federal sources are US-government public domain. Exceptions
noted in manifests: Transitland (third-party aggregator, key terms),
CDC/CFTC Socrata datasets (public, standard data.gov terms).

## Batch closure

Per the mandate: **stop adding new candidates.** The Scout returns to its
normal duty — daily quarantine verification and streak accumulation. Next
milestones are unchanged: deploy for continuous evidence accumulation, and
prospect number one.
