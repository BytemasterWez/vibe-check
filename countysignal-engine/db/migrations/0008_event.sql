-- Event definitions come from contracts/events/*.yaml; the definition rows
-- mirror the config so occurrences are always traceable to an exact version.

CREATE TABLE event.definitions (
    event_id                text PRIMARY KEY,
    description             text,
    base_variable           text NOT NULL REFERENCES norm.variable_dictionary(variable_id),
    feature_id              text NOT NULL,          -- transform used by the condition
    operator                text NOT NULL CHECK (operator IN ('>=','<=','>','<','==')),
    threshold               numeric NOT NULL,
    time_grain              text NOT NULL,
    minimum_history_months  integer NOT NULL DEFAULT 0,
    config_yaml             text NOT NULL,
    config_hash             text NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE event.occurrences (
    occurrence_id    bigserial PRIMARY KEY,
    event_id         text NOT NULL REFERENCES event.definitions(event_id),
    county_fips      char(5) NOT NULL REFERENCES ref.counties(county_fips),
    period           date NOT NULL,
    trigger_value    numeric,
    feature_run_id   bigint REFERENCES feature.feature_runs(feature_run_id),
    detected_at      timestamptz NOT NULL DEFAULT now(),
    detail           jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (event_id, county_fips, period)
);
CREATE INDEX ON event.occurrences (event_id, period);

CREATE TABLE event.case_control_sets (
    set_id           bigserial PRIMARY KEY,
    event_id         text NOT NULL REFERENCES event.definitions(event_id),
    feature_run_id   bigint REFERENCES feature.feature_runs(feature_run_id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    case_count       integer NOT NULL,
    control_count    integer NOT NULL,
    excluded_count   integer NOT NULL,
    matching_config  jsonb NOT NULL DEFAULT '{}'::jsonb,
    members          jsonb NOT NULL
        -- [{county_fips, period, role: case|control|excluded, reason}]
);
