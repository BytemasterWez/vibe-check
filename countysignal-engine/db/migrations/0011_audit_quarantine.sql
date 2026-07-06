-- Operational evidence (audit) and failed/uncertain records (quarantine).
-- Nothing silently disappears: records that fail validation or joins land
-- in quarantine with enough context to reprocess them.

CREATE TABLE audit.jobs (
    job_id       bigserial PRIMARY KEY,
    job_type     text NOT NULL,       -- ingestion | normalisation | features | event | experiment | scoring | validation
    subject      text,                -- source_id / event_id / recipe_id
    started_at   timestamptz NOT NULL DEFAULT now(),
    finished_at  timestamptz,
    status       text NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','succeeded','failed','partial')),
    detail       jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE audit.validation_results (
    id           bigserial PRIMARY KEY,
    level        text NOT NULL
        CHECK (level IN ('source','geography','variable','feature','experiment')),
    subject      text NOT NULL,       -- source_id / variable_id / feature_run_id / experiment_id
    check_name   text NOT NULL,
    passed       boolean NOT NULL,
    severity     text NOT NULL DEFAULT 'error' CHECK (severity IN ('info','warning','error')),
    observed     jsonb,
    expected     jsonb,
    ingestion_run_id bigint,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit.validation_results (subject, created_at DESC);

CREATE TABLE audit.schema_drift (
    id               bigserial PRIMARY KEY,
    source_id        text NOT NULL,
    ingestion_run_id bigint,
    expected_fields  jsonb NOT NULL,
    observed_fields  jsonb NOT NULL,
    added_fields     jsonb NOT NULL DEFAULT '[]'::jsonb,
    missing_fields   jsonb NOT NULL DEFAULT '[]'::jsonb,
    detected_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit.row_count_checks (
    id               bigserial PRIMARY KEY,
    source_id        text NOT NULL,
    ingestion_run_id bigint,
    stage            text NOT NULL,   -- raw | src | norm
    expected         bigint,
    observed         bigint NOT NULL,
    passed           boolean NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit.join_quality (
    id               bigserial PRIMARY KEY,
    source_id        text NOT NULL,
    ingestion_run_id bigint,
    total_records    bigint NOT NULL,
    matched          bigint NOT NULL,
    match_rate       numeric NOT NULL,
    by_confidence    jsonb NOT NULL DEFAULT '{}'::jsonb,
    unmatched_sample jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit.api_usage (
    id           bigserial PRIMARY KEY,
    request_id   text NOT NULL,
    api_key_hash text,
    method       text NOT NULL,
    path         text NOT NULL,
    status_code  integer NOT NULL,
    duration_ms  numeric,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit.errors (
    id           bigserial PRIMARY KEY,
    component    text NOT NULL,
    subject      text,
    error_type   text,
    message      text NOT NULL,
    traceback    text,
    context      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quarantine.records (
    id               bigserial PRIMARY KEY,
    source_id        text NOT NULL,
    ingestion_run_id bigint,
    stage            text NOT NULL,   -- parse | validate | load_src | normalise
    reason           text NOT NULL,
    record           jsonb NOT NULL,
    source_record_id text,
    resolved         boolean NOT NULL DEFAULT false,
    resolution       text,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON quarantine.records (source_id, resolved);

CREATE TABLE quarantine.join_candidates (
    id               bigserial PRIMARY KEY,
    source_id        text NOT NULL,
    ingestion_run_id bigint,
    raw_geography    jsonb NOT NULL,      -- what the source said (name, fips, state...)
    candidate_fips   char(5),
    candidate_score  numeric,
    method           text NOT NULL DEFAULT 'MATCH_CANDIDATE_FUZZY',
    review_status    text NOT NULL DEFAULT 'pending'
        CHECK (review_status IN ('pending','approved','rejected')),
    reviewed_by      text,
    reviewed_at      timestamptz,
    record           jsonb NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quarantine.validation_failures (
    id               bigserial PRIMARY KEY,
    source_id        text NOT NULL,
    ingestion_run_id bigint,
    check_name       text NOT NULL,
    record           jsonb,
    detail           jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now()
);
