-- Source contracts, versions, and ingestion metadata.

CREATE TABLE registry.sources (
    source_id           text PRIMARY KEY,
    name                text NOT NULL,
    owner               text NOT NULL,
    category            text NOT NULL,
    access_method       text NOT NULL,
    access_url          text,
    licence_status      text NOT NULL,
    scraping_allowed    boolean NOT NULL DEFAULT false,
    api_key_required    boolean NOT NULL DEFAULT false,
    update_frequency    text,
    geography_level     text NOT NULL,
    time_grain          text NOT NULL,
    canonical_join_key  text NOT NULL DEFAULT 'county_fips',
    raw_format          text,
    status              text NOT NULL DEFAULT 'UNVERIFIED'
        CHECK (status IN ('UNVERIFIED','DOCS_CONFIRMED','ACCESS_CONFIRMED','SAMPLE_CAPTURED',
                          'SCHEMA_MAPPED','VALIDATION_PASSING','COUNTY_JOIN_PASSING',
                          'PRODUCTION_ALLOWED','DISABLED')),
    contract_yaml       text NOT NULL,          -- verbatim contract for reproducibility
    contract_hash       text NOT NULL,
    production_allowed  boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE registry.source_versions (
    source_version_id   bigserial PRIMARY KEY,
    source_id           text NOT NULL REFERENCES registry.sources(source_id),
    version_label       text NOT NULL,          -- e.g. contract hash prefix or upstream vintage
    contract_hash       text NOT NULL,
    valid_from          timestamptz NOT NULL DEFAULT now(),
    valid_to            timestamptz,
    notes               text,
    UNIQUE (source_id, version_label)
);

CREATE TABLE registry.source_fields (
    source_id       text NOT NULL REFERENCES registry.sources(source_id),
    field_name      text NOT NULL,
    field_type      text NOT NULL,
    required        boolean NOT NULL DEFAULT false,
    description     text,
    PRIMARY KEY (source_id, field_name)
);

CREATE TABLE registry.ingestion_runs (
    ingestion_run_id    bigserial PRIMARY KEY,
    source_id           text NOT NULL REFERENCES registry.sources(source_id),
    source_version      text NOT NULL,
    mode                text NOT NULL CHECK (mode IN ('dry_run','sample','full','incremental')),
    started_at          timestamptz NOT NULL DEFAULT now(),
    finished_at         timestamptz,
    status              text NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','succeeded','failed','partial')),
    records_fetched     bigint,
    records_loaded      bigint,
    records_quarantined bigint,
    error               text,
    run_params          jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE registry.source_health (
    source_id           text PRIMARY KEY REFERENCES registry.sources(source_id),
    status              text NOT NULL,
    last_successful_run timestamptz,
    last_failed_run     timestamptz,
    consecutive_failures integer NOT NULL DEFAULT 0,
    latest_period       text,
    freshness_days      integer,
    county_join_rate    numeric,
    row_count_latest    bigint,
    detail              jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE registry.licence_terms (
    source_id       text NOT NULL REFERENCES registry.sources(source_id),
    licence_status  text NOT NULL,
    terms_url       text,
    attribution_text text,
    scraping_allowed boolean NOT NULL DEFAULT false,
    redistribution_allowed boolean,
    reviewed_at     timestamptz,
    reviewed_by     text,
    notes           text,
    PRIMARY KEY (source_id, licence_status)
);

CREATE INDEX ON registry.ingestion_runs (source_id, started_at DESC);
