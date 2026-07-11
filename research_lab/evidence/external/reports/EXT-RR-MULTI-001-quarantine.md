# Quarantine report — EXT-RR-MULTI-001

- Files: **490**, total **2.02 GB**
- Radar `.bin`: 162; reference CSV: 324 (Target1 162, Target2 162)
- Other: DataSetDescription&ParametersSetting.pdf, DatasetFramework.pdf, RadarDataProcessing.zip, read_log.m
- Bin filename convention: `adc_{bandwidth}_position{p}_ ({test}).bin` — bandwidths ['2GHZ', '2_5GHZ', '3GHZ'], positions [1, 2, 3, 4, 5, 6, 7, 9], tests [1, 2, 3, 4, 5, 6]
- Uniform bin sizes (bytes): [10607872, 11520000] — most 11,520,000 (1200 frames); some shorter (~1105 frames).
- Duplicate hashes: 1 pair(s): log_Target2_2GHZ_position2_ (4).csv == log_Target2_3GHZ_position2_ (4).csv
- Empty/malformed files: 0 / 0

## Radar parameters (frozen, from PDF Table 2 + author code)

- start_freq_ghz: 60
- adc_samples: 200
- adc_rate_ksps: 4000
- pulse_duration_us: 57
- frame_period_ms: 50
- frame_rate_hz: 20
- num_frames: 1200
- chirp_per_frame: 1
- num_rx: 4
- num_tx: 3
- slopes_mhz_per_us: {'3GHZ': 60, '2_5GHZ': 50, '2GHZ': 40}
- source: DataSetDescription&ParametersSetting.pdf Table 2 + read_log.m/Main.m

## Position geometry (Table 1) — establishes distinct-range vs co-located

| pos | θ1 | θ2 | r1 | r2 | config |
|--|--|--|--|--|--|
| 1 | 40° | 20° | 1.0m | 1.0m | distinct_angle_same_range |
| 2 | 20° | 40° | 1.4m | 1.4m | distinct_angle_same_range |
| 3 | 40° | 40° | 1.4m | 1.0m | same_angle_distinct_range |
| 4 | 20° | 20° | 1.0m | 0.6m | same_angle_distinct_range |
| 5 | 20° | 40° | 1.4m | 1.0m | distinct_angle_distinct_range |
| 6 | 40° | 20° | 0.6m | 1.0m | distinct_angle_distinct_range |
| 7 | 40° | 40° | 0.6m | 0.6m | co_located_same_angle_same_range |
| 8 | 40° | 40° | 1.0m | 1.0m | co_located_same_angle_same_range |
| 9 | 20° | 20° | 1.4m | 1.4m | co_located_same_angle_same_range |

## Reference finding (pivotal)

- CSV columns: **['ECG', 'PCG']** via ADS1292R biopotential AFE at ~125 Hz.
- Respiratory trace present: **False**.
- Reference is CARDIAC (ECG + phonocardiogram). No direct respiratory belt/capnography trace. Respiratory-band energy fraction negligible (measured 0.00-0.19). Respiratory rate is NOT directly recoverable from the reference.

## Decode validation

- 1200 frames recovered at 20 Hz; coherent range bins ~30-31; respiration-band signal present; antennas disagree (hint of two subjects). .bin is deterministically interpretable => NOT ADAPTER_INVALID.

## Truth-bearing paths

- Filenames encode scenario (position/bandwidth/test) and reference target identity (log_Target1/Target2). These MUST NOT be exposed to estimator processes; the adapter passes only decoded channels.
