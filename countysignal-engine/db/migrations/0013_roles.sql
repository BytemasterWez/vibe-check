-- Read-only role for the API service. The password is set out-of-band:
--   ALTER ROLE countysignal_api_ro WITH PASSWORD :'CSE_API_RO_PASSWORD';
-- (scripts/migrate.py runs that using the env var when present.)

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'countysignal_api_ro') THEN
        CREATE ROLE countysignal_api_ro LOGIN;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA api TO countysignal_api_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA api TO countysignal_api_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA api GRANT SELECT ON TABLES TO countysignal_api_ro;

-- Single write surface for the API role: usage logging.
GRANT USAGE ON SCHEMA audit TO countysignal_api_ro;
GRANT INSERT ON audit.api_usage TO countysignal_api_ro;
GRANT USAGE ON SEQUENCE audit.api_usage_id_seq TO countysignal_api_ro;

-- The API role can see ONLY api.* views. It gets no grant on registry, raw,
-- src, norm, feature, event, experiment, score, audit or quarantine, and the
-- api.* views execute with their owner's privileges — so raw internal tables
-- are unreachable through this role by construction.
