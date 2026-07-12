# Historical backtests

A backtest is an experiment with an explicit train/test window split instead
of the default fractional split. The harness reuses the engine unchanged.

## 1. Backfill history

The `bls_laus` contract carries a second official access path
(`historical_url`: the LAUS time-series flat file `la.data.64.County`,
county monthly series, 1990–present):

```bash
python -m scripts.run_pipeline --source bls_laus --mode full \
    --param dataset=historical --param start_year=2009
python -m scripts.run_features
```

Volume note: a 2009+ national backfill is roughly 630k county-months
(~2.5M normalised observations). Ingestion uses chunked batch inserts;
budget minutes, not hours. `start_year` trims the window — start it one
year before your training window so 12-month lag features are defined at
the training start.

## 2. Run the backtest

```bash
python -m scripts.run_backtest --event unemployment_spike_2pp_12m \
    --train-start 2010-01-01 --split 2019-01-01 --test-end 2024-12-31 \
    --k 50 100
```

Labels strictly before `--split` train the model; labels at/after it are
held out. Features for each label are taken `--horizon` months earlier
(default 6). The event's trigger feature is excluded from the design
matrix, and every run is compared against naive baselines.

## 3. Outputs

`exports/backtests/<event>_<stamp>/` contains:

- `report.json` / `report.md` — windows, case/control counts, AUC,
  precision@k / recall@k vs baselines, ranked variables, top false
  positives and false negatives with county names
- `scorecard.csv` — every test-window county-period ranked by predicted
  probability, with the actual outcome
- `methodology.md` — sources, coverage, event definition, matching,
  features, models, baselines, limitations, provenance and freshness,
  generated from the registry at run time

## Honest reporting

A fixture-data backtest validates the harness, not the model. Only a
backtest over the full national historical ingest is commercial evidence,
and its methodology note — including false positives and limitations —
ships with the numbers.
