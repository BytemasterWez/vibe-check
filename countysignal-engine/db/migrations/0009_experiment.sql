-- Experiment runs: case/control scoring experiments and their diagnostics.

CREATE TABLE experiment.runs (
    experiment_id    bigserial PRIMARY KEY,
    event_id         text NOT NULL REFERENCES event.definitions(event_id),
    feature_run_id   bigint NOT NULL REFERENCES feature.feature_runs(feature_run_id),
    case_control_set_id bigint REFERENCES event.case_control_sets(set_id),
    started_at       timestamptz NOT NULL DEFAULT now(),
    finished_at      timestamptz,
    status           text NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','succeeded','failed')),
    case_count       integer,
    control_count    integer,
    train_period     text,     -- e.g. '2015-01..2021-12'
    test_period      text,
    config           jsonb NOT NULL DEFAULT '{}'::jsonb,
    diagnostics_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE experiment.models (
    model_id         bigserial PRIMARY KEY,
    experiment_id    bigint NOT NULL REFERENCES experiment.runs(experiment_id),
    model_type       text NOT NULL,   -- baseline_* | logistic_regression | random_forest
    is_baseline      boolean NOT NULL DEFAULT false,
    hyperparams      jsonb NOT NULL DEFAULT '{}'::jsonb,
    artifact_path    text,            -- serialized model in object storage, if kept
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE experiment.metrics (
    model_id         bigint NOT NULL REFERENCES experiment.models(model_id),
    metric           text NOT NULL,   -- auc | precision_at_k | recall_at_k | ...
    k                integer NOT NULL DEFAULT 0,   -- 0 = not a @k metric
    split            text NOT NULL DEFAULT 'test',   -- train | test
    value            numeric NOT NULL,
    PRIMARY KEY (model_id, metric, split, k)
);

CREATE TABLE experiment.variable_rankings (
    experiment_id    bigint NOT NULL REFERENCES experiment.runs(experiment_id),
    model_id         bigint NOT NULL REFERENCES experiment.models(model_id),
    feature_id       text NOT NULL,
    rank             integer NOT NULL,
    importance       numeric,
    direction        text,            -- positive | negative
    PRIMARY KEY (model_id, feature_id)
);

CREATE TABLE experiment.case_control_diagnostics (
    experiment_id    bigint NOT NULL REFERENCES experiment.runs(experiment_id),
    check_name       text NOT NULL,
    passed           boolean NOT NULL,
    detail           jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (experiment_id, check_name)
);
