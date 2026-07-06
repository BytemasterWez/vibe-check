-- Immutable raw ingestion artifacts. Rows here are never updated or deleted;
-- re-ingesting the same content is detected by content_hash.

CREATE TABLE raw.files (
    raw_artifact_id      bigserial PRIMARY KEY,
    source_id            text NOT NULL REFERENCES registry.sources(source_id),
    source_version       text NOT NULL,
    ingestion_run_id     bigint NOT NULL REFERENCES registry.ingestion_runs(ingestion_run_id),
    retrieved_at         timestamptz NOT NULL,
    source_url           text,
    request_params       jsonb NOT NULL DEFAULT '{}'::jsonb,
    file_path            text NOT NULL,          -- object-store key or local path
    content_type         text,
    content_hash         text NOT NULL,          -- sha256 of the raw bytes
    size_bytes           bigint,
    record_count_claimed bigint,
    record_count_loaded  bigint,
    licence_status       text NOT NULL,
    UNIQUE (source_id, content_hash)
);

CREATE TABLE raw.api_payloads (
    raw_artifact_id      bigserial PRIMARY KEY,
    source_id            text NOT NULL REFERENCES registry.sources(source_id),
    source_version       text NOT NULL,
    ingestion_run_id     bigint NOT NULL REFERENCES registry.ingestion_runs(ingestion_run_id),
    retrieved_at         timestamptz NOT NULL,
    source_url           text NOT NULL,
    request_params       jsonb NOT NULL DEFAULT '{}'::jsonb,
    file_path            text NOT NULL,
    content_hash         text NOT NULL,
    size_bytes           bigint,
    record_count_claimed bigint,
    record_count_loaded  bigint,
    licence_status       text NOT NULL,
    UNIQUE (source_id, content_hash)
);

CREATE TABLE raw.extract_manifests (
    manifest_id       bigserial PRIMARY KEY,
    ingestion_run_id  bigint NOT NULL REFERENCES registry.ingestion_runs(ingestion_run_id),
    source_id         text NOT NULL REFERENCES registry.sources(source_id),
    artifact_table    text NOT NULL,   -- 'raw.files' | 'raw.api_payloads'
    raw_artifact_id   bigint NOT NULL,
    manifest          jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
);
