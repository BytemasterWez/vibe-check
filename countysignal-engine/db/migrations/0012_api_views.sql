-- Stable API views. The FastAPI service reads ONLY from api.* through a
-- read-only role; internal tables are never exposed directly. Changing a
-- view's contract requires a versioned migration.

CREATE VIEW api.county_profile AS
SELECT c.county_fips,
       c.state_fips,
       c.state_abbr,
       c.state_name,
       c.county_name,
       c.county_type,
       c.county_equivalent_name,
       c.land_area,
       c.water_area,
       CASE WHEN c.centroid_lon IS NULL THEN NULL
            ELSE jsonb_build_object('type', 'Point', 'coordinates',
                                    jsonb_build_array(c.centroid_lon, c.centroid_lat))
       END AS centroid_geojson,
       c.is_active
FROM ref.counties c;

CREATE VIEW api.variable_dictionary AS
SELECT variable_id, source_id, name, description, unit, time_grain,
       geography_grain, directionality, higher_is_good, transform_allowed,
       first_available_period, latest_available_period
FROM norm.variable_dictionary;

-- Latest observation per county/variable plus history depth: the payload
-- behind /v1/counties/{fips}/signal-pack.
CREATE VIEW api.county_signal_pack AS
SELECT DISTINCT ON (o.county_fips, o.variable_id)
       o.county_fips,
       o.variable_id,
       d.name          AS variable_name,
       d.time_grain,
       o.period_start  AS latest_period,
       o.value_numeric AS latest_value,
       o.unit,
       o.source_id,
       o.confidence
FROM norm.county_observations o
JOIN norm.variable_dictionary d USING (variable_id)
ORDER BY o.county_fips, o.variable_id, o.period_start DESC;

CREATE VIEW api.county_scores AS
SELECT s.score_id, s.recipe_id, s.event_id, s.county_fips,
       c.county_name, c.state_abbr,
       s.period, s.score, s.rank_national, s.rank_state, s.confidence,
       s.top_positive_factors, s.top_negative_factors, s.evidence_json,
       s.model_version, s.created_at
FROM score.county_scores s
JOIN ref.counties c USING (county_fips);

CREATE VIEW api.county_rankings AS
SELECT r.recipe_id, r.period, r.county_fips, c.county_name, c.state_abbr,
       r.rank_national, r.rank_state, r.score
FROM score.county_rankings r
JOIN ref.counties c USING (county_fips);

CREATE VIEW api.event_scorecards AS
SELECT o.event_id,
       d.description AS event_description,
       o.county_fips,
       c.county_name,
       c.state_abbr,
       o.period,
       o.trigger_value,
       d.operator,
       d.threshold,
       o.detected_at
FROM event.occurrences o
JOIN event.definitions d USING (event_id)
JOIN ref.counties c USING (county_fips);

CREATE VIEW api.source_health AS
SELECT s.source_id, s.name, s.category, s.status AS lifecycle_status,
       h.status AS health_status, h.last_successful_run, h.last_failed_run,
       h.consecutive_failures, h.latest_period, h.freshness_days,
       h.county_join_rate, h.row_count_latest, h.updated_at
FROM registry.sources s
LEFT JOIN registry.source_health h USING (source_id);

CREATE VIEW api.events AS
SELECT event_id, description, base_variable, feature_id, operator, threshold,
       time_grain, minimum_history_months, created_at
FROM event.definitions;

CREATE VIEW api.experiments AS
SELECT r.experiment_id, r.event_id, r.feature_run_id, r.status, r.case_count,
       r.control_count, r.train_period, r.test_period, r.diagnostics_json,
       r.created_at,
       m.model_id, m.model_type, m.is_baseline,
       jsonb_object_agg(
           mt.metric || CASE WHEN mt.k > 0 THEN '_' || mt.k::text ELSE '' END, mt.value
       ) FILTER (WHERE mt.metric IS NOT NULL) AS metrics
FROM experiment.runs r
JOIN experiment.models m USING (experiment_id)
LEFT JOIN experiment.metrics mt USING (model_id)
GROUP BY r.experiment_id, m.model_id;

CREATE VIEW api.experiment_top_variables AS
SELECT v.experiment_id, v.model_id, m.model_type, v.feature_id, v.rank,
       v.importance, v.direction
FROM experiment.variable_rankings v
JOIN experiment.models m USING (model_id);

-- Full provenance chain for a normalised observation: which run, which raw
-- artifact, which hash, retrieved when, under which licence.
CREATE VIEW api.provenance AS
SELECT o.county_fips,
       o.variable_id,
       o.period_start,
       o.time_grain,
       o.value_numeric,
       o.source_id,
       o.source_version,
       o.confidence,
       o.provenance_json,
       r.mode            AS ingestion_mode,
       r.started_at      AS ingestion_started_at,
       f.source_url,
       f.content_hash,
       f.retrieved_at,
       f.licence_status
FROM norm.county_observations o
LEFT JOIN registry.ingestion_runs r
       ON r.ingestion_run_id = (o.provenance_json->>'ingestion_run_id')::bigint
LEFT JOIN raw.files f
       ON f.raw_artifact_id = (o.provenance_json->>'raw_artifact_id')::bigint
      AND f.source_id = o.source_id;
