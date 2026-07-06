-- Canonical reference tables. ref.counties is the master geography table:
-- every county-level record in the system must join to it on county_fips.

CREATE TABLE ref.states (
    state_fips  char(2) PRIMARY KEY,
    state_abbr  char(2) NOT NULL UNIQUE,
    state_name  text NOT NULL,
    is_state    boolean NOT NULL DEFAULT true,   -- false for DC / territories
    is_active   boolean NOT NULL DEFAULT true
);

-- Canonical count: 3,144 county-equivalents (50 states + DC, 2023 vintage,
-- Connecticut planning regions). See docs/data_model.md#canonical-county-count.
CREATE TABLE ref.counties (
    county_fips             char(5) PRIMARY KEY,
    state_fips              char(2) NOT NULL REFERENCES ref.states(state_fips),
    state_abbr              char(2) NOT NULL,
    state_name              text NOT NULL,
    county_name             text NOT NULL,
    county_type             text NOT NULL DEFAULT 'county',
        -- county | parish | borough | census_area | city_and_borough |
        -- municipality | independent_city | planning_region | district
    county_equivalent_name  text NOT NULL,
    centroid_lat            numeric,
    centroid_lon            numeric,
    land_area               numeric,   -- square metres
    water_area              numeric,   -- square metres
    valid_from              date NOT NULL DEFAULT '2020-01-01',
    valid_to                date,
    is_active               boolean NOT NULL DEFAULT true,
    CHECK (substring(county_fips from 1 for 2) = state_fips)
);

CREATE INDEX ON ref.counties (state_fips);
CREATE INDEX ON ref.counties (lower(county_name));

-- PostGIS geometry columns (boundary polygons + point centroid), only when
-- the extension is installed. TIGER boundary loading is a deployment step;
-- see docs/deployment.md.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
        EXECUTE 'ALTER TABLE ref.counties ADD COLUMN geometry geometry(MultiPolygon, 4326)';
        EXECUTE 'ALTER TABLE ref.counties ADD COLUMN centroid geometry(Point, 4326)';
    END IF;
END
$$;

-- Alternate names/spellings used by upstream sources (e.g. "LaSalle" vs
-- "La Salle", "Dona Ana" vs "Doña Ana", "St." vs "Saint").
CREATE TABLE ref.geography_aliases (
    alias_id     bigserial PRIMARY KEY,
    county_fips  char(5) NOT NULL REFERENCES ref.counties(county_fips),
    alias_name   text NOT NULL,
    alias_scope  text NOT NULL DEFAULT 'name',   -- name | abbreviation | historical
    source_hint  text                             -- which upstream uses it, if known
);
CREATE UNIQUE INDEX geography_aliases_unique
    ON ref.geography_aliases (county_fips, lower(alias_name));

-- Official crosswalks for FIPS changes (e.g. 46113 Shannon -> 46102 Oglala
-- Lakota; 51515 Bedford City -> 51019 Bedford; 09xxx CT counties -> 091xx
-- planning regions).
CREATE TABLE ref.fips_crosswalks (
    crosswalk_id    bigserial PRIMARY KEY,
    old_fips        char(5) NOT NULL,
    new_fips        char(5) NOT NULL REFERENCES ref.counties(county_fips),
    change_type     text NOT NULL,   -- rename | merge | split | recode
    effective_date  date,
    authority       text,            -- e.g. 'Census Bureau Geography Division'
    notes           text,
    UNIQUE (old_fips, new_fips)
);

CREATE TABLE ref.naics (
    naics_code   text PRIMARY KEY,
    level        integer NOT NULL,
    title        text NOT NULL,
    parent_code  text
);

CREATE TABLE ref.source_categories (
    category    text PRIMARY KEY,
    description text
);

INSERT INTO ref.source_categories (category, description) VALUES
    ('labour',        'Employment, unemployment, wages, workforce'),
    ('demographics',  'Population, income, poverty, education'),
    ('housing',       'Rents, prices, permits, housing stock'),
    ('business',      'Establishments, lending, branches'),
    ('hazard',        'Natural hazard risk, disasters, climate'),
    ('migration',     'Population and income migration flows'),
    ('public_money',  'Federal spending, grants, contracts'),
    ('agriculture',   'Agricultural production and services'),
    ('poverty',       'Poverty and economic distress measures');
