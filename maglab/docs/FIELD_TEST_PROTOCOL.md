# MagLab Field Test Protocol

Repeatability matters more than raw anomaly strength. A single spike is
never proof. Run these tests in order before trusting any survey output,
and before any Phase 4+ development.

## Preparation (all tests)

- Remove keys, coins and magnetic accessories from the pocket holding the
  phone; note anything you can't remove in **Visible contamination notes**.
- Use a consistent mount (hand or wooden pole) and record it in the
  survey setup.
- Walk at a steady pace under 2.5 m/s. The app warns when you're too fast.
- Wait for the "Too few samples for baseline" warning to clear before
  judging any reading.

## Test 1 — Known metal control (manhole / fence / bridge)

1. Choose a known metal object.
2. Create survey: target type = **Known metal control**.
3. Walk a 20 m × 20 m grid.
4. Repeat three times as separate runs on the same survey:
   - north–south,
   - east–west,
   - north–south repeat.
5. Add a manual marker (**Known target**) at the object.
6. Save the survey.
7. Export CSV and GeoJSON (Phase 5).
8. Upload to backend if consent is enabled (Phase 7).
9. Run the repeatability comparison (Phase 6).

**Pass conditions**

- The known target produces a repeatable anomaly across runs.
- Peak location drift under 5 m where GPS quality allows.
- Repeatability score above 70.
- Quality warnings are acceptable or explainable.
- Single spikes are not treated as confirmed anomalies.

*Until Phases 5–6 ship, the interim pass condition is: the known target
produces an elevated residual (≥ 5 µT) with score ≥ 60 at roughly the same
track position in all three runs, visible on the Live Recording screen and
in the Survey Detail summary.*

## Test 2 — Open grass control

Create survey: target type = **Open grass control**. Walk the same grid
pattern in an open area away from visible infrastructure.

**Pass condition**

- No false high-confidence anomaly is generated (no sustained samples with
  score ≥ 60 and confidence ≥ 0.75).

## Test 3 — Old industrial / made-ground area

Create survey: target type = **Old industrial site**.

**Pass condition**

- Anomalies appear but are labelled as possible infrastructure / made
  ground / unknown (`likely_ferrous_or_infrastructure`,
  `possible_local_anomaly`) — never as confirmed geology.

## Recording the results

For each test, keep: the survey name, date, device model, weather notes,
CSV/GeoJSON exports (once available) and a short verdict against the pass
conditions. These control surveys become the first labelled entries in the
anomaly library — controls and false positives are as valuable as hits.
