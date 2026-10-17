# Carrier Due-Diligence Report (FMCSA) — TEST tool

A concierge tool that turns a USDOT number into an evidence-based carrier
due-diligence report from public FMCSA data. This is deliberately **not** a
platform — no logins, dashboards, subscriptions, or monitoring. It exists to
generate reports for manual sale and buyer testing. It earns the right to
become software only after someone pays for the report.

```sh
node generate.mjs <USDOT> [<USDOT> ...] --out ./out        # writes carrier-<dot>.html
node generate.mjs 54283 --json                             # structured output
# PDF: open the HTML and "Save as PDF", or headless Chromium --print-to-pdf
```

## What it reports (per the agreed spec)

1. **Identity** — legal/DBA name, USDOT & MC/docket, operating status, fleet
   size, drivers, hazmat, location, first-seen and last-updated dates.
2. **Authority & insurance** — census operating status; insurance is **not** in
   the bulk public data, so it is pushed to the verification checklist.
3. **Safety evidence** — crashes (lifetime **and** rolling 24-month, with
   dates), inspection file window, 24-month inspections, and vehicle/driver
   out-of-service rates vs national roadside averages.
4. **Fraud & identity warning signs** — new authority, inactive status, zero
   power units, implausible ratios, insufficient inspection data, elevated
   recent crash frequency.
5. **Decision** — one of: *Lower observed concern* · *Manual verification
   required* · *Elevated observed concern* · *Do not proceed until discrepancies
   are resolved*. Never "safe" or "fraudulent".
6. **Verification checklist** — the operational steps a broker must still take,
   because public data cannot confirm who is actually contacting them.

## Data-integrity findings (audited against the live datasets)

These are the traps that would destroy trust if reported naively — all handled
in `fmcsa.mjs`:

- **The crash file is LIFETIME.** Swift shows 23,777 distinct crashes spanning
  **1989–2026**. The meaningful figure is the rolling **24-month** count (~806).
  The report always shows both, with dates, and scores off the 24-month figure.
- **The inspection file is a ~3-year rolling window**, a different grain from
  crashes. The report states the actual window rather than implying "lifetime".
- **Distinct `crash_id`/`inspection_id` == row count** (verified), so these
  sets are not duplicated — but we still `count(distinct …)` defensively.
- **Numeric fields are stored as STRINGS** (`viol_total`, `oos_total`,
  `fatalities`, …); `sum()` silently returns nothing. All arithmetic parses to
  integer first, and out-of-service rates are computed in JS from the parsed
  24-month rows.
- **`dot_number` filtering is exact** (every returned row matches the requested
  number) — confirmed before trusting joins.

## Labelling rule (important)

The numeric score is an **"Independent Carrier Risk Indicator based on public
FMCSA records"** — our own calculation. It is **not** an FMCSA Safety
Measurement System (SMS) score or percentile. FMCSA's SMS applies severity/time
weights, exposure measures, data-sufficiency rules, and peer-group percentiles
that we do not reproduce. Official FMCSA data, official SMS measures, our
calculated indicator, and our interpretation are kept clearly separate.

## What it does NOT promise

Public data cannot prove a carrier is legitimate at the moment a load is booked
— fraudsters impersonate real, clean carriers. A clean USDOT history does not
confirm the identity of the person emailing or calling. The report is
decision-support and evidence, not a guarantee; the verification checklist is
mandatory.

## Data sources (all public, structured JSON via Socrata unless noted)

- Motor Carrier Census — `az4n-8mr2`
- Crash File — `aayw-vxb3`
- Inspection File — `fx4q-ay7w`
- Authority/insurance detail — FMCSA L&I (`li-public.fmcsa.dot.gov`, not bulk)

## Status

Reusable ideas from the aircraft pipeline (entity resolution, scoring, plain
verdict, evidence links, HTML/PDF) applied to a bigger market. Validated on
real carriers across profiles: large/active (lower concern), brand-new
(verify), inactive authority (do not proceed). Next step is buyer testing, not
more engineering.
