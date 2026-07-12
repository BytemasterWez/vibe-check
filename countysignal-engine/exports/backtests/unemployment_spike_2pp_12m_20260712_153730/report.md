# Backtest report — unemployment_spike_2pp_12m
- experiment_id: 34
- windows: train 2013-02-01..2013-09-01 | test 2014-04-01..2015-04-01 (horizon 6m)
- cases: 10  controls: 100
- best model: logistic_regression

## Metrics (test window)
- auc: 0.9696
- precision_at_100: 0.0980
- precision_at_50: 0.1000
- recall_at_100: 1.0000
- recall_at_50: 1.0000

## Baselines
- baseline_national_average: auc=0.5000
- baseline_previous_value: auc=0.8500

## Top variables
1. bls_laus_unemployment_rate__change_1m (positive, 0.8164)
2. bls_laus_labor_force__latest_value (negative, -0.5119)
3. bls_laus_labor_force__zscore_national (negative, -0.5119)
4. bls_laus_unemployment_rate__rolling_avg_12m (positive, 0.4846)
5. bls_laus_unemployment_rate__rank_national (positive, 0.4344)
6. bls_laus_unemployment_rate__latest_value (positive, 0.3884)
7. bls_laus_unemployment_rate__pct_change_12m (negative, -0.3729)
8. bls_laus_unemployed__pct_change_12m (negative, -0.3719)
9. bls_laus_unemployment_rate__zscore_national (positive, 0.2715)
10. bls_laus_unemployment_rate__rolling_avg_3m (positive, 0.2711)
11. bls_laus_unemployment_rate__change_3m (negative, -0.2315)
12. bls_laus_unemployment_rate__zscore_state (negative, -0.1339)
13. bls_laus_unemployed__zscore_national (positive, 0.1111)
14. bls_laus_unemployed__latest_value (positive, 0.0952)
15. bls_laus_unemployment_rate__rank_state (negative, -0.0097)

## Top false positives (test window)
- Bedford, VA @ 2015-04-01 p=0.4357
- King, WA @ 2014-04-01 p=0.3006
- Jefferson, KY @ 2014-07-01 p=0.2471
- Polk, IA @ 2015-02-01 p=0.2306
- Hennepin, MN @ 2015-02-01 p=0.1848
- Bedford, VA @ 2014-07-01 p=0.1551
- Cass, ND @ 2014-11-01 p=0.1538
- Providence, RI @ 2014-11-01 p=0.129
- King, WA @ 2014-11-01 p=0.125
- Cook, IL @ 2015-02-01 p=0.1177

## Top false negatives (test window)
- Oglala Lakota, SD @ 2014-11-01 p=0.2608
- St. Tammany, LA @ 2015-04-01 p=0.2613
- Pulaski, AR @ 2015-02-01 p=0.2815
- Caddo, LA @ 2014-04-01 p=0.3179
- Cuyahoga, OH @ 2014-07-01 p=0.5307
