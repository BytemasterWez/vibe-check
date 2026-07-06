-- Source-specific parsed tables (Milestone 1 sources). These retain
-- source-native field names but every table carries the mandatory
-- provenance columns. New sources add their own table here via migration.

-- Provenance columns required on every src.* table:
--   source_id, source_version, ingestion_run_id, raw_artifact_id,
--   retrieved_at, source_record_id, source_row_hash

CREATE TABLE src.bls_laus (
    id                bigserial PRIMARY KEY,
    -- source fields (BLS LAUS county table layout)
    series_id         text,
    area_code         text,            -- e.g. CN2210300000000
    area_fips         text,            -- state+county fips as published
    area_title        text,
    period_year       integer NOT NULL,
    period_month      integer NOT NULL,
    labor_force       numeric,
    employed          numeric,
    unemployed        numeric,
    unemployment_rate numeric,
    -- provenance
    source_id         text NOT NULL,
    source_version    text NOT NULL,
    ingestion_run_id  bigint NOT NULL REFERENCES registry.ingestion_runs(ingestion_run_id),
    raw_artifact_id   bigint NOT NULL,
    retrieved_at      timestamptz NOT NULL,
    source_record_id  text NOT NULL,
    source_row_hash   text NOT NULL,
    UNIQUE (source_id, source_record_id, source_row_hash)
);
CREATE INDEX ON src.bls_laus (area_fips, period_year, period_month);

CREATE TABLE src.census_acs (
    id                bigserial PRIMARY KEY,
    -- source fields (ACS 5-year county estimates)
    geo_id            text,            -- e.g. 0500000US22103
    state_code        text,
    county_code       text,
    name              text,
    acs_year          integer NOT NULL,
    variable_code     text NOT NULL,   -- e.g. B19013_001E
    estimate          numeric,
    margin_of_error   numeric,
    -- provenance
    source_id         text NOT NULL,
    source_version    text NOT NULL,
    ingestion_run_id  bigint NOT NULL REFERENCES registry.ingestion_runs(ingestion_run_id),
    raw_artifact_id   bigint NOT NULL,
    retrieved_at      timestamptz NOT NULL,
    source_record_id  text NOT NULL,
    source_row_hash   text NOT NULL,
    UNIQUE (source_id, source_record_id, source_row_hash)
);
CREATE INDEX ON src.census_acs (state_code, county_code, acs_year);

CREATE TABLE src.fema_nri (
    id                 bigserial PRIMARY KEY,
    -- source fields (FEMA National Risk Index county file)
    nri_id             text,
    stcofips           text,           -- 5-digit county fips as published
    state_name         text,
    county_name        text,
    nri_version        text,
    risk_score         numeric,
    risk_rating        text,
    eal_score          numeric,        -- expected annual loss
    social_vuln_score  numeric,
    community_resilience_score numeric,
    population         numeric,
    -- provenance
    source_id          text NOT NULL,
    source_version     text NOT NULL,
    ingestion_run_id   bigint NOT NULL REFERENCES registry.ingestion_runs(ingestion_run_id),
    raw_artifact_id    bigint NOT NULL,
    retrieved_at       timestamptz NOT NULL,
    source_record_id   text NOT NULL,
    source_row_hash    text NOT NULL,
    UNIQUE (source_id, source_record_id, source_row_hash)
);
CREATE INDEX ON src.fema_nri (stcofips);
