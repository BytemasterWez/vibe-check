-- Canonical normalised county-time observations. Everything downstream
-- (features, events, experiments, scores) reads ONLY from norm.*.

CREATE TABLE norm.variable_dictionary (
    variable_id             text PRIMARY KEY,
    source_id               text NOT NULL REFERENCES registry.sources(source_id),
    name                    text NOT NULL,
    description             text,
    unit                    text NOT NULL,
    time_grain              text NOT NULL CHECK (time_grain IN ('month','quarter','year','static')),
    geography_grain         text NOT NULL DEFAULT 'county',
    directionality          text,               -- e.g. 'rate', 'level', 'index', 'count'
    higher_is_good          boolean,
    transform_allowed       boolean NOT NULL DEFAULT true,
    source_field            text,
    normalisation_method    text,
    missing_value_policy    text NOT NULL DEFAULT 'null',
    first_available_period  text,
    latest_available_period text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE norm.variable_sources (
    variable_id     text NOT NULL REFERENCES norm.variable_dictionary(variable_id),
    source_id       text NOT NULL REFERENCES registry.sources(source_id),
    source_version  text NOT NULL,
    role            text NOT NULL DEFAULT 'primary',   -- primary | fallback | component
    PRIMARY KEY (variable_id, source_id, source_version)
);

-- Long/EAV county-time fact table, monthly grain.
CREATE TABLE norm.county_month_variables (
    id               bigserial PRIMARY KEY,
    county_fips      char(5) NOT NULL REFERENCES ref.counties(county_fips),
    period_start     date NOT NULL,
    period_end       date NOT NULL,
    variable_id      text NOT NULL REFERENCES norm.variable_dictionary(variable_id),
    value_numeric    numeric,
    value_text       text,
    value_json       jsonb,
    unit             text NOT NULL,
    source_id        text NOT NULL,
    source_version   text NOT NULL,
    confidence       text NOT NULL DEFAULT 'MATCH_EXACT_FIPS',
    provenance_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (county_fips, period_start, variable_id, source_id, source_version)
);
CREATE INDEX ON norm.county_month_variables (variable_id, period_start);
CREATE INDEX ON norm.county_month_variables (county_fips, variable_id);

-- Annual grain.
CREATE TABLE norm.county_year_variables (
    id               bigserial PRIMARY KEY,
    county_fips      char(5) NOT NULL REFERENCES ref.counties(county_fips),
    period_start     date NOT NULL,
    period_end       date NOT NULL,
    variable_id      text NOT NULL REFERENCES norm.variable_dictionary(variable_id),
    value_numeric    numeric,
    value_text       text,
    value_json       jsonb,
    unit             text NOT NULL,
    source_id        text NOT NULL,
    source_version   text NOT NULL,
    confidence       text NOT NULL DEFAULT 'MATCH_EXACT_FIPS',
    provenance_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (county_fips, period_start, variable_id, source_id, source_version)
);
CREATE INDEX ON norm.county_year_variables (variable_id, period_start);
CREATE INDEX ON norm.county_year_variables (county_fips, variable_id);

-- Slow-moving / static county attributes (e.g. NRI risk scores, land area).
CREATE TABLE norm.county_static_variables (
    id               bigserial PRIMARY KEY,
    county_fips      char(5) NOT NULL REFERENCES ref.counties(county_fips),
    variable_id      text NOT NULL REFERENCES norm.variable_dictionary(variable_id),
    as_of            date NOT NULL,
    value_numeric    numeric,
    value_text       text,
    value_json       jsonb,
    unit             text NOT NULL,
    source_id        text NOT NULL,
    source_version   text NOT NULL,
    confidence       text NOT NULL DEFAULT 'MATCH_EXACT_FIPS',
    provenance_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (county_fips, variable_id, as_of, source_id, source_version)
);

-- Generic view unioning the grains, for profile/provenance reads.
CREATE VIEW norm.county_observations AS
SELECT county_fips, period_start, period_end, variable_id, value_numeric, value_text,
       unit, source_id, source_version, confidence, provenance_json, created_at,
       'month'::text AS time_grain
FROM norm.county_month_variables
UNION ALL
SELECT county_fips, period_start, period_end, variable_id, value_numeric, value_text,
       unit, source_id, source_version, confidence, provenance_json, created_at, 'year'
FROM norm.county_year_variables
UNION ALL
SELECT county_fips, as_of, as_of, variable_id, value_numeric, value_text,
       unit, source_id, source_version, confidence, provenance_json, created_at, 'static'
FROM norm.county_static_variables;

-- Only the first five join confidence labels may enter norm.* automatically;
-- MATCH_CANDIDATE_FUZZY and NO_MATCH must go to quarantine instead.
ALTER TABLE norm.county_month_variables ADD CONSTRAINT chk_confidence
    CHECK (confidence IN ('MATCH_EXACT_FIPS','MATCH_EXACT_GEOID','MATCH_CROSSWALK',
                          'MATCH_EXACT_NAME','MATCH_ALIAS'));
ALTER TABLE norm.county_year_variables ADD CONSTRAINT chk_confidence
    CHECK (confidence IN ('MATCH_EXACT_FIPS','MATCH_EXACT_GEOID','MATCH_CROSSWALK',
                          'MATCH_EXACT_NAME','MATCH_ALIAS'));
ALTER TABLE norm.county_static_variables ADD CONSTRAINT chk_confidence
    CHECK (confidence IN ('MATCH_EXACT_FIPS','MATCH_EXACT_GEOID','MATCH_CROSSWALK',
                          'MATCH_EXACT_NAME','MATCH_ALIAS'));
