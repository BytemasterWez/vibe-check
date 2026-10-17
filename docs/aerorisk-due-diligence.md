# AeroRisk Due Diligence — Product Verdict & Spec

## Verdict

Yes, this can and should be built — but only as a narrow aircraft/operator due-diligence product, not as a live private-aircraft tracking product.

The easiest profitable wedge is:

> **AeroRisk Graph** — public aircraft/operator risk intelligence for aircraft buyers, brokers, lenders, insurers, charter customers, maintenance shops, and aviation lawyers.

The product should answer:

> "Before I buy, finance, insure, charter, broker, maintain, or partner with this aircraft/operator, what does the public evidence say about its risk profile?"

Aircraft is easier than vessels because the public U.S. aviation data is cleaner: the FAA aircraft registration database is downloadable and refreshed daily, FAA Service Difficulty Reports are downloadable by year as CSV files, NTSB CAROL has U.S. civil aviation accident data from 1962 to present, and FAA publishes quarterly enforcement action compilations.

---

## Product spec: AeroRisk Graph

### 1. Core product promise

AeroRisk Graph identifies public safety, maintenance, compliance, utilisation, ownership, and operational risk signals around aircraft and aviation operators.

It does **not** say:

> "This aircraft is unsafe."

It says:

> "These public records suggest issues worth reviewing before a financial, legal, insurance, maintenance, or charter decision."

That wording matters. Aviation is legally sensitive.

---

### 2. Best first product

**Aircraft Due-Diligence Risk Pack**

A paid report for someone considering buying, financing, insuring, chartering, brokering, or maintaining a specific aircraft.

**Example buyer question**

> "I'm looking at buying or financing this used aircraft. What public issues should I know before I proceed?"

**Output**

A 5–12 page report showing:

- aircraft identity
- registration history
- make/model/serial/engine
- ownership changes
- accident/incident history
- FAA Service Difficulty Reports
- airworthiness directive exposure
- enforcement action links where applicable
- utilisation estimate from ADS-B history
- recurring defect categories
- comparable model risk themes
- airport/operational context
- plain-English risk summary
- confidence rating
- recommended manual checks

**First paid price test**

| Product | Price |
| --- | --- |
| Single aircraft public-risk snapshot | $250–$500 |
| Full aircraft due-diligence pack | $750–$1,500 |
| Broker/lender recurring watchlist | $1,500–$3,000/month |
| Portfolio review for insurer/lender | $3,000–$10,000/report |

The first realistic win is $500–$1,500 for a buyer/broker/lender aircraft pack.

---

### 3. Second product

**Charter Operator Risk Snapshot**

For people considering using, financing, insuring, or partnering with a charter operator.

Score public signals around:

- aircraft age and fleet composition
- repeated defects
- NTSB events
- FAA enforcement actions
- aircraft utilisation
- maintenance-risk themes
- runway/airport exposure
- ownership/registration complexity
- public safety narratives

FAA enforcement reports are useful here because FAA publishes quarterly compilations of closed enforcement actions involving civil penalties, certificate suspensions, or revocations.

---

### 4. What not to build

Do **not** build:

- celebrity/private jet tracker
- live "where is this person flying?" product
- pilot-risk score from private records
- public accusation engine
- "this operator is unsafe" ranking
- tool relying on restricted pilot records

The FAA Pilot Records Database is access-controlled; FAA says private pilots cannot access the PRD, and access requires specific pilot certificate/medical conditions. So this product should not touch private pilot records.

Also, aircraft registration records can contain personally identifiable information, and the FAA has a process for owners to request that certain names/addresses be withheld from broad public display. That means privacy has to be designed in from day one.

---

### 5. Data sources

**Tier 1 — must-have**

| Source | Use | Access reality |
| --- | --- | --- |
| FAA aircraft registration database | aircraft identity, owner, serial, model, engine, registration status | downloadable; refreshed daily |
| FAA Service Difficulty Reports | defects, failures, maintenance issues, recurring component problems | downloadable by year as CSV |
| NTSB CAROL | accident/incident history | official aviation accident/incident search |
| FAA enforcement reports | public compliance/enforcement history | quarterly official reports |
| FAA Airworthiness Directives | legally required unsafe-condition corrections | official FAA AD source |
| ADS-B / flight track data | utilisation, routes, activity, irregular operation patterns | needs licensed/compliant source |
| NASA ASRS | safety narratives and human-factor themes | useful but "soft" and unverified |
| FAA runway incursion data | airport surface-risk context | ASIAS data |
| FAA wildlife strike data | airport/model/operator hazard context | public FAA database |

FAA Airworthiness Directives are legally enforceable regulations issued to correct unsafe conditions in aircraft, engines, propellers, or appliances. NASA ASRS is valuable for safety themes, but NASA warns that ASRS reports are voluntary, self-reported, unverified, and subject to reporting bias. So ASRS should be used for themes, not hard accusations.

---

### 6. ADS-B data reality

Movement data is useful, but this is where you must be careful.

OpenSky is useful for research, but its terms say commercial or for-profit use requires a written licence, and operational REST API use requires prior written agreement. ADS-B Exchange offers live and historical flight data products and API access, including a low-cost developer route, but anything commercial should be treated as licensed data, not free public raw material.

**Practical approach**

For MVP:

- use FAA/NTSB/SDR/enforcement/AD data first
- use ADS-B only where licence terms are clear
- avoid live tracking as the core product
- focus on historical utilisation and due diligence

That keeps the product cleaner and easier to sell.

---

### 7. Main intelligence modules

#### Module 1 — Aircraft identity graph

Resolve:

- N-number
- ICAO hex
- serial number
- make/model
- engine type
- registration date
- owner/entity
- previous registration changes
- certificate type
- aircraft category/class
- airworthiness status

Purpose: establish the aircraft identity before scoring anything.

This is the spine. Bad entity resolution ruins the whole product.

#### Module 2 — Maintenance risk fingerprint

Uses FAA SDRs.

Score:

- number of SDRs linked to aircraft/model/component
- repeated failures by ATA/JASC category
- engine/propeller/landing gear/electrical issues
- defect narratives
- defect severity wording
- repeated similar issues across same model
- recentness of reports
- comparison to same aircraft type

FAA says SDR files contain reports from operators and repair stations about malfunctions, failures, or defects, and that these reports are used for identifying safety trends and maintaining airworthiness.

**Output example**

> "This aircraft model shows repeated SDR themes around landing gear and electrical systems. This specific tail number has no obvious direct SDR match, but the model-level maintenance theme should be reviewed during pre-buy inspection."

Important: separate tail-specific evidence from model-level evidence.

#### Module 3 — Accident and incident history

Uses NTSB CAROL.

Score:

- direct aircraft accident/incident match
- same model accident themes
- operator-related events
- location/airport patterns
- injury/fatality/damage severity
- probable cause where available
- unresolved vs closed investigation

NTSB CAROL provides aviation records from 1962 to present.

**Output example**

> "No direct NTSB match found for this registration/serial combination. Same-model events show recurring themes around loss of control on landing; relevant for insurance/pre-buy discussion but not a defect claim against this aircraft."

#### Module 4 — Airworthiness Directive exposure

Uses FAA ADs.

Score:

- ADs applying to make/model/engine/propeller/appliance
- recurring AD-heavy components
- recent AD activity
- severity of unsafe condition
- whether AD compliance evidence is missing from supplied docs

This is valuable for aircraft buyers because AD compliance affects airworthiness, cost, and legal operation.

**Product angle:** "Pre-buy AD exposure checklist." This alone could be a paid mini-product.

#### Module 5 — Utilisation and activity profile

Uses licensed ADS-B/historical flight data.

Score:

- recent activity
- long inactivity
- heavy utilisation
- training-like repetitive circuits
- short-hop stress pattern
- harsh-environment airports
- coastal/corrosion exposure
- high-altitude/pressurisation cycle estimate
- unusual repositioning before sale
- mismatch between advertised use and observed use

**Output example**

> "The aircraft appears lightly active over the past 90 days, with intermittent repositioning rather than regular private/charter use. Low activity may be benign, but it raises storage, battery, corrosion, and maintenance-continuity questions."

This is one of the most sellable features for buyers.

#### Module 6 — Enforcement and compliance history

Uses FAA enforcement reports.

Score:

- operator enforcement history
- certificate suspensions/revocations
- civil penalties
- maintenance organisation issues
- charter/Part 135 issues
- airport/operator patterns

This is stronger for operator risk than individual aircraft risk.

**Output label:** use "public enforcement history". Do not use "bad operator".

#### Module 7 — Human factors / training proxy

Uses NASA ASRS and public enforcement/NTSB narratives.

Score themes:

- checklist failures
- runway confusion
- unstable approaches
- communication breakdown
- dispatch pressure
- maintenance sign-off issues
- fatigue
- weather decision-making
- training environment risk
- aircraft-type-specific handling issues

ASRS includes sanitized narratives from pilots, controllers, mechanics, flight attendants, dispatchers, and others, but NASA says the reports are voluntary and not independently verified.

**Output label:** use "human-factors theme". Do not use "pilot incompetence" or "training failure."

#### Module 8 — Airport risk context

Uses FAA runway incursion and wildlife strike data.

Score:

- home airport runway incursion history
- airport wildlife strike exposure
- training-airport congestion
- difficult runway layout
- weather/terrain exposure
- airport operational risk themes

FAA ASIAS runway-incursion data currently covers 2001–2026 and shows 35,182 events in the source snapshot. FAA also maintains a public Wildlife Strike Database; FAA says each strike report includes location/time and aircraft impact details, and the public database exceeded 200,000 reports in 2018.

**Buyer value** — useful for:

- flight schools
- insurers
- airport consultants
- charter operators
- aircraft buyers reviewing where an aircraft has operated

---

### 8. Final scoring model

Each aircraft gets a 0–100 risk score, but the sub-scores matter more than the headline score.

| Sub-score | Meaning |
| --- | --- |
| Identity confidence | How certain we are that records match the correct aircraft |
| Registration complexity | ownership changes, trusts, registration churn |
| Maintenance signal | SDRs, recurring component issues, defect narratives |
| AD exposure | applicable AD volume/severity/recentness |
| Accident/incident signal | direct and model/operator NTSB history |
| Utilisation signal | heavy use, inactivity, training patterns, cycle stress |
| Enforcement/compliance | public FAA enforcement links |
| Human-factors themes | ASRS/NTSB narrative patterns, clearly caveated |
| Airport exposure | runway incursion/wildlife/weather/terrain risk context |
| Report confidence | evidence strength and match quality |

**Score bands**

| Score | Meaning |
| --- | --- |
| 0–20 | Low public risk signal |
| 21–40 | Some review points |
| 41–60 | Material due-diligence questions |
| 61–80 | High review priority |
| 81–100 | Serious public-risk concentration; manual expert review recommended |

Never let the product say "safe" or "unsafe." Say:

> "Public records show low/moderate/high review priority."

---

### 9. Example report structure

**AeroRisk Aircraft Due-Diligence Pack**

**Section 1 — Executive summary**

- Aircraft reviewed
- Overall review priority
- Top 5 findings
- Confidence rating
- Recommended next checks

**Section 2 — Aircraft identity**

- N-number
- make/model
- serial
- engine
- year
- registration status
- owner/entity
- identity match confidence

**Section 3 — Registration and ownership**

- registration timeline
- ownership changes
- entity/trust flags
- export/import clues
- missing data warnings

**Section 4 — Maintenance and defect signals**

- tail-specific SDRs
- model-level SDR themes
- component clusters
- defect recency
- suggested mechanic review points

**Section 5 — AD exposure**

- applicable AD themes
- recent ADs
- high-cost/high-severity AD concerns
- pre-buy document checklist

**Section 6 — Accident/incident history**

- direct NTSB matches
- model/operator context
- probable-cause themes
- severity and recency

**Section 7 — Utilisation profile**

- recent movement activity
- inactivity periods
- route profile
- training-like behaviour
- cycle/stress proxy

**Section 8 — Operator/compliance context**

- FAA enforcement matches
- certificate/action context
- public compliance indicators

**Section 9 — Airport/environment context**

- home airport risks
- wildlife strike exposure
- runway incursion exposure
- weather/terrain considerations

**Section 10 — Buyer checklist**

- questions for seller
- documents to request
- mechanic inspection priorities
- insurance questions
- lender/broker red flags

---

### 10. Buyer segments

**Best first buyers**

| Buyer | Why they pay |
| --- | --- |
| Used aircraft buyers | avoid expensive mistake |
| Aircraft brokers | better pre-sale intelligence |
| Aviation lenders | collateral and operational risk |
| Aviation insurers | underwriting signal |
| A&P / pre-buy inspection shops | better inspection checklist |
| Charter customers | operator due diligence |
| Aviation lawyers | litigation/research support |
| Flight schools | fleet and airport risk monitoring |

**The easiest buyer to reach:** aircraft buyers and brokers.

Why? They already understand that one missed issue can cost thousands.

The best first sales message is:

> "Send me an N-number. I'll produce a public-record aircraft risk snapshot before you spend money on a pre-buy, finance application, insurance quote, or ferry trip."

---

### 11. Monetisation model

**Phase 1 — manual report service**

Start as a paid research pack, not software.

| Offer | Price |
| --- | --- |
| N-number quick scan | $99–$199 |
| Full aircraft public-risk pack | $750–$1,500 |
| Broker batch: 10 aircraft | $2,500–$5,000 |
| Lender/insurer portfolio screen | $5,000+ |
| Monthly watchlist | $1,500–$3,000/month |

**Phase 2 — dashboard**

Only build dashboard after paid reports prove demand.

Features:

- aircraft search
- saved watchlists
- risk score
- report export
- new SDR/AD/NTSB/enforcement alerts
- broker/lender portfolio view

**Phase 3 — API/data licence**

Later product: "Aircraft due-diligence enrichment API."

For brokers, insurers, marketplaces, aircraft listing sites, lenders.

Do not start here. Too early.

---

### 12. Validation gates

**Gate 1 — data access**

Pass if you can build 100 aircraft records with:

- FAA registry match
- make/model/serial fields
- SDR model-level match
- NTSB search result
- AD lookup
- at least partial utilisation data
- confidence score

**Gate 2 — signal quality**

Pass if 20 aircraft produce:

- at least 10 meaningful report findings
- at least 5 high-quality risk stories
- no unsupported accusations
- clear evidence trail

**Gate 3 — buyer reaction**

Send 10 sample teasers to:

- aircraft brokers
- pre-buy inspection mechanics
- aviation lenders
- aviation insurance brokers
- flying clubs
- charter customers

Pass if:

- 2 ask for the full report
- 1 asks what it costs
- 1 offers a real aircraft to test
- 1 pays anything

**Gate 4 — revenue**

Pass only if:

- one person pays $250+
- or one broker gives a batch list
- or one aviation professional says they would resell/use it with clients

**Kill criteria**

Kill or park if:

- buyers say they already get this easily
- data matching is too unreliable
- no one will pay after 30 direct outreach attempts
- legal/privacy constraints make the useful version impossible
- reports are interesting but do not change buyer behaviour

---

### 13. What makes it defensible

The moat is not "AI."

The moat is:

- entity resolution across aircraft identifiers
- repeatable public-record enrichment
- plain-English aviation-risk interpretation
- clean citations/evidence
- confidence scoring
- buyer-ready reports
- historical watchlists
- accumulated model/type/operator patterns

Aviation data exists, but most normal buyers do not know how to join FAA registry + SDR + NTSB + AD + enforcement + flight activity + airport-risk context into a useful decision pack.

That is the monetisable gap.

---

### 14. Best first test

Start with 20 aircraft listed for sale.

For each one, produce:

- FAA identity match
- SDR history/themes
- NTSB event check
- AD exposure summary
- utilisation signal
- owner/registration notes
- plain-English risk summary
- "questions to ask seller/mechanic"

Then send sample teasers to aircraft brokers and pre-buy mechanics.

The first paid offer should be:

> "Send me any N-number and I'll produce a public-record aircraft risk pack before you spend money on the aircraft."

---

### 15. Blunt recommendation

Build it — but build it as a manual-first paid intelligence service, not a software platform.

The first version should be ugly but valuable:

> N-number in → evidence-backed PDF out.

Do not overbuild. Do not start with live tracking. Do not claim safety certification. Do not score pilots. Do not scrape restricted/private sources.

- **The strongest first name:** AeroRisk Due Diligence
- **The strongest first customer:** used aircraft buyers, brokers, and pre-buy inspection shops.
- **The simplest validation target:** one paid aircraft risk report at $500+ within 30 outreach attempts.
