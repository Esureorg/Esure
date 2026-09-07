-- Run once as the database owner. Managed services that prohibit CREATE ROLE
-- should provision equivalent least-privilege credentials in their control plane.
CREATE ROLE esure_application NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE esure_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE esure_maintenance NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE esure_migrations NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

GRANT USAGE, CREATE ON SCHEMA public TO esure_migrations;

-- Grant exactly one group role to each provider-managed LOGIN credential:
-- GRANT esure_application TO <application_login>;
-- GRANT esure_worker TO <worker_login>;
-- GRANT esure_maintenance TO <maintenance_login>;
-- GRANT esure_migrations TO <migration_login>;
