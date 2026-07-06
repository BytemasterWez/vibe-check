-- Feature matrices computed from norm.* by the feature engine.

CREATE TABLE feature.feature_definitions (
    feature_id       text PRIMARY KEY,            -- e.g. bls_laus_unemployment_rate__change_12m
    variable_id      text NOT NULL REFERENCES norm.variable_dictionary(variable_id),
    transform        text NOT NULL,               -- latest_value | change_12m | zscore_national | ...
    params           jsonb NOT NULL DEFAULT '{}'::jsonb,
    description      text,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feature.feature_runs (
    feature_run_id   bigserial PRIMARY KEY,
    started_at       timestamptz NOT NULL DEFAULT now(),
    finished_at      timestamptz,
    status           text NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','succeeded','failed')),
    as_of_period     date,                        -- data cutoff used (leakage guard)
    config           jsonb NOT NULL DEFAULT '{}'::jsonb,
    row_count        bigint
);

CREATE TABLE feature.feature_matrix (
    id               bigserial PRIMARY KEY,
    feature_run_id   bigint NOT NULL REFERENCES feature.feature_runs(feature_run_id),
    county_fips      char(5) NOT NULL REFERENCES ref.counties(county_fips),
    period           date NOT NULL,
    feature_id       text NOT NULL REFERENCES feature.feature_definitions(feature_id),
    feature_value    numeric,
    feature_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (feature_run_id, county_fips, period, feature_id)
);
CREATE INDEX ON feature.feature_matrix (feature_run_id, feature_id, period);
CREATE INDEX ON feature.feature_matrix (county_fips, period);

CREATE TABLE feature.feature_quality (
    feature_run_id   bigint NOT NULL REFERENCES feature.feature_runs(feature_run_id),
    feature_id       text NOT NULL REFERENCES feature.feature_definitions(feature_id),
    period           date,
    coverage         numeric,      -- share of active counties with a value
    null_rate        numeric,
    mean             numeric,
    stddev           numeric,
    p01              numeric,
    p99              numeric,
    checks           jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (feature_run_id, feature_id, period)
);
