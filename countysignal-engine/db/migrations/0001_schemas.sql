-- Schemas and extensions. ref.counties carries PostGIS geometry when the
-- extension is available (production compose uses postgis/postgis); every
-- other table is plain Postgres, and portable centroid_lat/centroid_lon
-- columns keep the engine fully functional without PostGIS.
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS postgis;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PostGIS unavailable — geometry columns will be skipped';
END
$$;

CREATE SCHEMA IF NOT EXISTS registry;
CREATE SCHEMA IF NOT EXISTS ref;
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS src;
CREATE SCHEMA IF NOT EXISTS stg;
CREATE SCHEMA IF NOT EXISTS norm;
CREATE SCHEMA IF NOT EXISTS feature;
CREATE SCHEMA IF NOT EXISTS event;
CREATE SCHEMA IF NOT EXISTS experiment;
CREATE SCHEMA IF NOT EXISTS score;
CREATE SCHEMA IF NOT EXISTS api;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS quarantine;
