# MagLab Data Dictionary

Field names are identical across the iOS store, CSV export, upload API and
backend tables (modulo naming convention). Every sample has a timestamp;
every anomaly has a confidence; every low-quality reading carries quality
flags.

## sensor_samples (one row per sample — CSV column order)

| Column | Type | Unit | Description |
|---|---|---|---|
| survey_id | UUID | | Owning survey |
| run_id | UUID | | Owning recording run |
| timestamp_utc | ISO 8601 | UTC | Sample time (always present) |
| latitude | double | deg | GPS latitude, empty when no fix |
| longitude | double | deg | GPS longitude, empty when no fix |
| horizontal_accuracy_m | double | m | GPS horizontal accuracy |
| altitude_m | double | m | GPS altitude |
| vertical_accuracy_m | double | m | GPS vertical accuracy |
| speed_mps | double | m/s | Ground speed |
| course_deg | double | deg | Course over ground |
| mag_x_uT | double | µT | Magnetometer X |
| mag_y_uT | double | µT | Magnetometer Y |
| mag_z_uT | double | µT | Magnetometer Z |
| mag_total_uT | double | µT | Total intensity √(x²+y²+z²) |
| accel_x / accel_y / accel_z | double | g | User acceleration |
| gyro_x / gyro_y / gyro_z | double | rad/s | Rotation rate |
| pitch / roll / yaw | double | rad | Device attitude |
| pressure_hPa | double | hPa | Barometric pressure |
| relative_altitude_m | double | m | Relative altitude since run start |
| local_baseline_uT | double | µT | Rolling median of recent mag_total |
| local_residual_uT | double | µT | mag_total − baseline (signed) |
| gps_quality_score | double | 0–1 | 1.0 at ≤5 m accuracy → 0.1 at ≥30 m; halved when stale; 0 when missing |
| motion_quality_score | double | 0–1 | Penalised by accel variance and rotation rate |
| anomaly_score | double | 0–100 | See score bands below |
| model_confidence | double | 0–1 | Base 0.9 minus penalties |
| likely_class | text | | See classes below |
| quality_flags | JSON array | | See flags below |

## Score bands (rule-based v1, |residual|)

| Residual | Band | Score |
|---|---|---|
| < 2 µT | low | 0–20 |
| 2–5 µT | mild | 20–50 |
| 5–15 µT | moderate | 50–80 |
| > 15 µT | strong | 80–100 (capped) |

Event clustering defaults (Phase 6): anomaly threshold 60, high-confidence
threshold 75, minimum cluster samples 5. All configurable
(`ScoringConfig`, version `rule-based-v1`).

## Confidence penalties

| Condition | Penalty |
|---|---|
| GPS missing | −0.30 |
| GPS accuracy > 10 m | −0.20 |
| Motion quality < 0.4 | −0.20 |
| Speed > 2.5 m/s | −0.15 |
| Single-sample spike | −0.35 (and score × 0.6) |

Missing magnetometer or insufficient baseline (< 25 samples) short-circuit
to score 0, class `insufficient_data`.

## likely_class values

`normal_background`, `possible_local_anomaly`,
`likely_ferrous_or_infrastructure`, `likely_motion_or_phone_noise`,
`poor_gps_quality`, `insufficient_data`.

Deliberately absent: any geology/mineral/utility claim.

## quality_flags values

`gps_missing`, `gps_accuracy_poor`, `gps_stale`, `insufficient_baseline`,
`motion_unstable`, `speed_too_high`, `single_sample_spike`,
`magnetometer_unavailable`, `barometer_unavailable`,
`orientation_unstable`, `mock_sensor_data`.

`mock_sensor_data` rows must be excluded from any real dataset.

## surveys

id, contributor_id, name, created_at, target_type, mount_position,
survey_pattern, signal_module, operator_notes, weather_notes,
contamination_notes (JSON array), share_setting, app_version,
device_model, uploaded_at, geom.

Controlled vocabularies (raw values): see `ios/MagLab/Models/SurveyEnums.swift`
— target types (`known_metal_control`, `open_grass_control`, …), mount
positions, survey patterns, signal modules, share settings
(`private_local_only` default, `share_anonymised`,
`share_full_precision_gps`, `research_contributor_mode`).

## survey_runs

id, survey_id, started_at, ended_at, is_complete, sample_count,
median_gps_accuracy_m, max_anomaly_score, high_confidence_anomaly_count,
repeatability_group_id, uploaded_at.

## survey_markers

id, survey_id, run_id, contributor_id, timestamp_utc, latitude, longitude,
geom, marker_type, note, created_at. Marker types include manhole, fence,
pipe_marker, bridge, metal_object, open_control_point, known_target,
suspected_anomaly, possible_contamination, photo_taken_externally,
road_defect, waterlogged_ground, old_industrial_feature, other.

## anomaly_events (Phase 6)

An anomaly is a cluster of consecutive samples, never a single spike:
id, survey_id, run_id, contributor_id, start_time, end_time, centre_lat,
centre_lon, geom, sample_count, max_score, mean_score, max_residual_uT,
confidence, likely_class, quality_flags, created_at.

## anomaly_labels (future — training moat)

id, anomaly_event_id, label (known target / false positive / repeatable /
unexplained / …), label_confidence, label_source, notes, created_at.
