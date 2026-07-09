# TenderPulse — Opportunity Discovery, Scoring & Selection

Phases 0B–2D of the autonomous product builder run. Live source verification
evidence is in `SOURCE_VALIDATION.md`; the final decision is in `DECISION.md`.

## Phase 0B — 90-day downside and budget check (winning idea)

**"If this has 0 customers after 90 days, what did I learn and what did I lose?"**

| Item | Assessment |
|---|---|
| Time lost | ~3–5 build days + ~2 days/month operation |
| Money lost | £0 data cost (both sources free, OGL v3 licensed) |
| Cloud cost | £5–10/month (single small VPS, SQLite) — under £30 for 90 days |
| API cost | £0 — no keys, no quotas purchased |
| Data licence cost | £0 |
| LLM cost | £0 (optional, capped at $5/month if enabled) |
| Reusable assets | OCDS connectors, canonical procurement schema, scoring engine, validation/quarantine framework — all reusable for any public-contracting product (UK or the 40+ other countries publishing OCDS) |
| Reusable knowledge | UK procurement buyer landscape, bid-consultant market |

**Downside classification: LOW.** Total 90-day worst case ≈ £30 cash plus time,
against a reusable multi-source ingestion framework. Passes the rule: likely
learning/asset value exceeds likely loss.

## Phase 1 — 30 candidate opportunities

Compact form: concept · buyer · data access · monetisation. Full 20-attribute
detail was generated for the top 10 (below).

| # | Idea | Buyer | Data access | Monetisation |
|---|---|---|---|---|
| 1 | **UK tender opportunity intelligence for SMEs** (scored, explained alerts) | SME bid teams, bid consultants | Contracts Finder + Find a Tender OCDS APIs — free, no auth, verified | £49–149/mo subscription |
| 2 | Contract award / incumbent-expiry intelligence (who holds what, when it renews) | Sales teams selling to public sector | Same OCDS APIs (award stage) — verified | £99–299/mo |
| 3 | UK planning application intelligence for trades/suppliers | Builders, architects, materials suppliers | planning.data.gov.uk API + council portals (fragmented) | £29–99/mo |
| 4 | Companies House risk monitor (director churn, late accounts, CCJ signals) | Credit controllers, suppliers | Companies House API (free key) | £49–199/mo |
| 5 | Grant/funding match alerts for SMEs & charities | SME owners, charity fundraisers | GOV.UK find-a-grant, UKRI — mixed structure | £19–79/mo |
| 6 | FSA hygiene-rating change monitor for food brands/insurers | Franchise brands, insurers | FSA ratings API — free, open | £99–299/mo |
| 7 | EPC/retrofit lead generation from energy certificates | Retrofit installers, solar firms | EPC register (free key, bulk CSV) | per-lead or £49–149/mo |
| 8 | CQC rating-change alerts for care-sector suppliers/investors | Care-home groups, lenders | CQC API — free | £99–249/mo |
| 9 | HSE enforcement/prosecution monitor for compliance officers | H&S consultants, insurers | HSE registers — HTML, scraping needed | £49–149/mo |
| 10 | Charity Commission financial-health screening | Grant makers, auditors | Charity Commission API/bulk — free | £99/mo or reports |
| 11 | Local licensing application monitor (alcohol, HMO, taxi) | Solicitors, landlords, operators | Council portals — highly fragmented | £29–99/mo |
| 12 | Public-sector framework/DPS deadline tracker | Bid managers | CCS + framework sites — semi-structured | £29–79/mo |
| 13 | NHS supply chain / tender intelligence for medtech | Medtech sales | FTS + NHS portals — partial | £199–499/mo |
| 14 | Court/insolvency notice monitor (Gazette) for credit risk | Trade creditors | The Gazette API — free | £49–149/mo |
| 15 | Utility DNO connection-queue intelligence for solar/BESS developers | Renewables developers | DNO ECR CSVs — inconsistent across DNOs | £199–499/mo |
| 16 | Road closure / streetworks intelligence for logistics | Fleet operators | one.network, Street Manager — access restrictions | £99/mo |
| 17 | School/MAT procurement-cycle intelligence for edtech vendors | Edtech sales teams | DfE data + CF — verified | £99–249/mo |
| 18 | Food-recall/alert compliance feed for retailers | Food retailers, brokers | FSA alerts API — free | £49/mo |
| 19 | Property auction result aggregation & yield screening | Small investors | Auction houses — scraping, fragile | £29/mo B2C-ish |
| 20 | Vehicle-fleet MOT/tax compliance dashboard | Fleet managers | DVLA/DVSA APIs (free keys) | £1–2/vehicle/mo |
| 21 | Ofsted rating-change alerts for tutoring/childcare chains | Education operators | Ofsted data — monthly CSV | £49/mo |
| 22 | Environment Agency permit/enforcement monitor | Waste/water contractors | EA public registers — mixed quality | £99/mo |
| 23 | New-business registration leads by sector/region | Accountants, banks, insurers | Companies House stream — free | £49–149/mo |
| 24 | Pharmacy/GP contract-change intelligence | Pharma distributors | NHS ODS data — free | £199/mo |
| 25 | Land Registry price-paid anomaly screening | Surveyors, lenders | Price Paid CSV — free, monthly | £99/mo |
| 26 | TRO (traffic regulation order) monitor for parking/delivery ops | Parking operators | Council gazettes — fragmented | £99/mo |
| 27 | Defra farm-payment/scheme deadline assistant | Agricultural consultants | Defra guidance — unstructured | £29/mo |
| 28 | API uptime/schema-drift watchdog for open-data-dependent firms | Data teams | Any public API — trivial access | £19–99/mo |
| 29 | Bid/no-bid decision support scoring past award data | Bid managers | OCDS award history — verified | £149/mo add-on |
| 30 | Immigration sponsor-licence register monitor for recruiters | Recruitment agencies | GOV.UK register CSV — free, daily | £49–99/mo |

## Phase 2 — Ruthless scoring

Weighted per the mandated weights (buyer pain 12%, willingness to pay 12%,
budget evidence 8%, data accessibility 10%, source reliability 8%,
normalisation/join 8%, build speed 8%, autonomy 8%, revenue 8%, operability 6%,
legal safety 6%, defensibility 4%, downside/reuse 2%).

| # | Idea | Pain | Pay | Budget | Data | Reliab. | Norm. | Speed | Auto | Rev | Oper. | Legal | Defens. | Downside | **Weighted** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Tender intelligence SME | 8 | 8 | 9 | 10 | 9 | 9 | 9 | 9 | 7 | 9 | 10 | 5 | 9 | **8.55** |
| 2 | Award/incumbent intel | 8 | 8 | 8 | 10 | 9 | 8 | 8 | 9 | 8 | 8 | 10 | 6 | 9 | **8.40** |
| 4 | Companies House risk | 7 | 7 | 8 | 9 | 9 | 8 | 8 | 9 | 7 | 8 | 8 | 4 | 9 | **7.79** |
| 14 | Gazette insolvency | 7 | 7 | 7 | 9 | 8 | 8 | 8 | 9 | 6 | 8 | 8 | 4 | 8 | **7.55** |
| 8 | CQC alerts | 7 | 7 | 7 | 9 | 8 | 8 | 8 | 9 | 6 | 8 | 8 | 4 | 8 | **7.55** |
| 6 | FSA hygiene monitor | 6 | 7 | 6 | 9 | 9 | 9 | 9 | 9 | 5 | 9 | 9 | 3 | 9 | **7.42** |
| 30 | Sponsor-licence monitor | 7 | 6 | 6 | 9 | 8 | 9 | 9 | 9 | 5 | 9 | 8 | 3 | 9 | **7.33** |
| 23 | New-business leads | 6 | 6 | 7 | 9 | 9 | 8 | 8 | 9 | 6 | 8 | 7 | 3 | 9 | **7.24** |
| 17 | Edtech procurement | 7 | 7 | 7 | 8 | 8 | 8 | 7 | 8 | 6 | 7 | 9 | 5 | 8 | **7.24** |
| 20 | Fleet MOT dashboard | 6 | 6 | 6 | 8 | 9 | 9 | 8 | 9 | 5 | 8 | 8 | 3 | 8 | **7.05** |
| 7 | EPC retrofit leads | 7 | 7 | 7 | 7 | 7 | 6 | 7 | 8 | 7 | 7 | 7 | 4 | 7 | **6.91** |
| 29 | Bid/no-bid support | 7 | 6 | 5 | 9 | 9 | 8 | 6 | 7 | 6 | 7 | 10 | 6 | 8 | **7.13** |
| 5 | Grant match | 7 | 5 | 4 | 6 | 6 | 5 | 7 | 7 | 5 | 8 | 9 | 3 | 8 | **5.95** |
| 13 | NHS medtech intel | 8 | 8 | 8 | 6 | 6 | 6 | 5 | 7 | 8 | 6 | 8 | 6 | 6 | **6.85** |
| 25 | Land Registry screening | 5 | 5 | 5 | 9 | 9 | 8 | 8 | 8 | 5 | 8 | 9 | 3 | 8 | **6.66** |
| 10 | Charity screening | 5 | 5 | 5 | 9 | 8 | 8 | 7 | 8 | 4 | 8 | 8 | 3 | 8 | **6.35** |
| 28 | API watchdog | 5 | 4 | 4 | 10 | 9 | 9 | 9 | 10 | 4 | 9 | 10 | 2 | 9 | **6.66** |
| 21 | Ofsted alerts | 5 | 5 | 4 | 8 | 8 | 8 | 8 | 8 | 4 | 8 | 8 | 3 | 8 | **6.19** |
| 18 | Food recalls | 5 | 4 | 4 | 9 | 9 | 9 | 9 | 9 | 3 | 9 | 9 | 2 | 9 | **6.29** |
| 3 | Planning intel | 8 | 7 | 7 | 4 | 4 | 4 | 5 | 6 | 7 | 6 | 8 | 6 | 6 | **5.95** |
| 15 | DNO queue intel | 8 | 8 | 7 | 4 | 4 | 4 | 4 | 6 | 8 | 5 | 8 | 7 | 5 | **5.93** |
| 9 | HSE monitor | 6 | 6 | 5 | 4 | 4 | 5 | 5 | 6 | 5 | 6 | 6 | 4 | 6 | **5.16** |
| 24 | Pharmacy/GP intel | 6 | 6 | 5 | 6 | 6 | 6 | 5 | 7 | 6 | 5 | 7 | 5 | 6 | **5.83** |
| 22 | EA permits | 6 | 5 | 5 | 5 | 5 | 5 | 5 | 6 | 5 | 6 | 7 | 4 | 6 | **5.34** |
| 12 | Framework tracker | 6 | 5 | 4 | 5 | 5 | 6 | 7 | 7 | 4 | 8 | 9 | 3 | 8 | **5.72** |
| 11 | Licensing monitor | 7 | 6 | 5 | 3 | 3 | 3 | 4 | 5 | 6 | 6 | 7 | 5 | 5 | **4.95** |
| 26 | TRO monitor | 6 | 6 | 5 | 3 | 3 | 3 | 4 | 5 | 5 | 5 | 7 | 5 | 5 | **4.76** |
| 16 | Streetworks intel | 6 | 6 | 5 | 4 | 4 | 4 | 4 | 6 | 5 | 5 | 6 | 4 | 5 | **4.90** |
| 19 | Auction aggregation | 5 | 4 | 3 | 3 | 3 | 4 | 4 | 5 | 4 | 6 | 5 | 3 | 5 | **4.05** |
| 27 | Farm-scheme assistant | 5 | 4 | 3 | 3 | 3 | 3 | 4 | 4 | 3 | 6 | 7 | 3 | 6 | **3.99** |

**Rejected on hard rules** (regardless of score): #11, #26 (fragile scraping of
hundreds of council portals, no backup source); #19 (fragile scraping,
weak B2B buyer); #27 (unstructured data, unclear buyer); #16 (access
restrictions); #15 as a *first* build (inconsistent DNO CSVs = MEDIUM/HIGH
data fragility, though the buyer is excellent).

## Top 10 — why they ranked highly, and their main weakness

1. **Tender intelligence for SMEs (8.55)** — Two verified, free, no-auth
   government APIs; buyers demonstrably pay £100–300/mo for incumbents
   (Tenders Direct, BiP, Stotles); daily pain with hard deadlines; fully
   automatable. *Weakness:* crowded category — must win on niche profiling,
   explainability, and price, not breadth.
2. **Award/incumbent intelligence (8.40)** — Same verified data, higher-value
   buyer (sales intelligence budget); award notices reveal contract end dates =
   renewal pipeline. *Weakness:* messier historical data; entity resolution of
   supplier names is genuinely hard.
3. **Companies House risk monitor (7.79)** — Free API, real credit-control
   budgets. *Weakness:* crowded (Creditsafe, Red Flag Alert); free tier of
   incumbents is strong.
4. **Gazette insolvency monitor (7.55)** — Official API, clear trigger events.
   *Weakness:* incumbents bundle this into credit reports; thin wedge.
5. **CQC alerts (7.55)** — Clean API, regulated-sector urgency. *Weakness:*
   niche buyer pool; CQC itself emails rating changes.
6. **FSA hygiene monitor (7.42)** — Trivially reliable API. *Weakness:* value
   concentrated in a few franchise/insurance buyers; low urgency between visits.
7. **Sponsor-licence register monitor (7.33)** — Daily CSV, compliance urgency.
   *Weakness:* single-signal product; feature not company.
8. **New-business leads (7.24)** — Streaming API, evergreen lead demand.
   *Weakness:* commodity data; heavy competition from established list sellers.
9. **Edtech procurement intelligence (7.24)** — Verified data + clear vertical
   buyer. *Weakness:* subset of idea #1; better as a TenderPulse vertical.
10. **Fleet MOT dashboard (7.05)** — Reliable APIs. *Weakness:* per-vehicle
    pricing means large fleets needed for meaningful revenue; telematics
    vendors bundle it.

## Phase 2B — Commercial reality check (condensed for top 3)

**#1 Tender intelligence:** Payer = SME owner/bid manager (job titles: Bid
Manager, BD Director, Managing Director of 5–50-person firms) or bid
consultants reselling to clients. Budget: existing "tender alerts /
business development tools" line — proven by incumbent pricing. Urgency:
missing a tender = missed revenue with a hard deadline; below-threshold
notices close in 2–4 weeks. Ignored if: their sector rarely tenders, or free
gov email alerts feel adequate. Replaces: manual portal checking (1–3
h/week), £100+/mo incumbent subscriptions, consultant retainers. Smallest
proof for a call: one week of scored, explained matches in their exact niche
with zero junk. Paid-pilot proof: 30-day digest trial that surfaces ≥1 tender
they'd genuinely bid. First offer: £99 one-off 30-day pilot → £49–99/mo.
Likely objection: "I already get free alerts from Contracts Finder" →
counter: free alerts are keyword-only, unranked, unexplained, and miss the
other portal. Bad-business risk: churn if a niche has sparse tender flow.

**#2 Award/incumbent:** Payer = sales/BD lead at public-sector suppliers.
Budget: sales intelligence (Tussell/Stotles line). Proof for pilot: renewal
calendar for their patch. Objection: Tussell already does this (at
£5k+/year — the wedge is price). Bad-business risk: entity resolution
quality; garbage renewal dates destroy trust.

**#3 Companies House risk:** Payer = credit controller/FD. Budget: credit
reports. Objection: "Creditsafe includes monitoring." Bad-business risk:
being a worse version of a mature product. **Downgraded.**

## Phase 2C — Competitor & substitute scan (top 3)

**Tender intelligence:** Direct — Tenders Direct (~£125/mo), BiP/Tracker,
Stotles (freemium→£k/yr), Tussell (enterprise), free gov email alerts.
Manual substitutes — weekly portal checking; bid consultants. **Wedge:**
(a) explainable scoring ("why this matched") vs keyword dumps; (b) both
official sources joined + deduplicated; (c) SME price point £49–99 vs £125+;
(d) white-label digests for bid consultants — a distribution channel the
incumbents ignore. Competitors prove budget; the category is not
winner-take-all because buying is niche-by-niche. Copy risk: high for
features, low for niche trust — mitigated by verticalising (e.g. edtech,
construction, care).

**Award/incumbent:** Tussell/Stotles strong at enterprise; wedge is SME price.
Harder data problem (supplier entity resolution) → second product, built on
the same pipeline.

**CH risk monitor:** Creditsafe/Experian/Red Flag dominate with better data
(they add payment-behaviour data you cannot legally obtain free). No wedge.
**Rejected.**

## Phase 2D — Unit economics (top 3; winner shown fully)

**TenderPulse (winner):** Infra £6–10/mo VPS (SQLite; Postgres at ~25+
customers +£10); data £0; LLM optional ≤$5 cap; email via Postmark free
tier→£10/mo. **Total ≤£20/mo at start.** Price £49–99/mo. Break-even: **1
customer.** At 5/10/25/50/100 customers (avg £70): £330 / £680 / £1,700 /
£3,400 / £6,900 gross margin ≈ 95%+. Support: digest quality queries;
~2–4 h/month maintenance (schema drift watch). Manual: profile setup
~30 min/customer once.

**Award/incumbent:** same infra; entity-resolution adds review time
(~1–2 h/wk). Higher price (£149–299) but slower to trustworthy output.

**CH monitor:** infra similar; CAC against entrenched incumbents makes
margin irrelevant. Rejected.

## Winner

**Idea #1 — TenderPulse: scored, explained UK tender alerts for SME niches,
white-labelable for bid consultants.** Highest weighted score; both data
sources live-verified during this run (see `SOURCE_VALIDATION.md`); LOW
90-day downside; break-even at one customer; builds reusable OCDS
infrastructure that idea #2 (award/renewal intelligence) can be stacked on
as the natural upsell.
