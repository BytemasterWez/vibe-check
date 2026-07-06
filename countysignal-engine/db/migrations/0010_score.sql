-- Scored outputs produced by recipes over experiment models.

CREATE TABLE score.score_versions (
    score_version_id bigserial PRIMARY KEY,
    recipe_id        text NOT NULL,
    event_id         text NOT NULL REFERENCES event.definitions(event_id),
    experiment_id    bigint NOT NULL REFERENCES experiment.runs(experiment_id),
    model_id         bigint NOT NULL REFERENCES experiment.models(model_id),
    model_version    text NOT NULL,
    recipe_config    jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE score.county_scores (
    score_id             bigserial PRIMARY KEY,
    score_version_id     bigint NOT NULL REFERENCES score.score_versions(score_version_id),
    recipe_id            text NOT NULL,
    event_id             text NOT NULL,
    county_fips          char(5) NOT NULL REFERENCES ref.counties(county_fips),
    period               date NOT NULL,
    score                numeric NOT NULL,
    rank_national        integer,
    rank_state           integer,
    confidence           text,
    top_positive_factors jsonb NOT NULL DEFAULT '[]'::jsonb,
    top_negative_factors jsonb NOT NULL DEFAULT '[]'::jsonb,
    evidence_json        jsonb NOT NULL DEFAULT '{}'::jsonb,
    model_version        text NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (score_version_id, county_fips, period)
);
CREATE INDEX ON score.county_scores (recipe_id, period, rank_national);

CREATE TABLE score.county_rankings (
    score_version_id bigint NOT NULL REFERENCES score.score_versions(score_version_id),
    recipe_id        text NOT NULL,
    period           date NOT NULL,
    county_fips      char(5) NOT NULL REFERENCES ref.counties(county_fips),
    rank_national    integer NOT NULL,
    rank_state       integer NOT NULL,
    score            numeric NOT NULL,
    PRIMARY KEY (score_version_id, period, county_fips)
);

CREATE TABLE score.score_explanations (
    score_id         bigint NOT NULL REFERENCES score.county_scores(score_id),
    feature_id       text NOT NULL,
    contribution     numeric NOT NULL,
    feature_value    numeric,
    explanation      text,
    PRIMARY KEY (score_id, feature_id)
);
