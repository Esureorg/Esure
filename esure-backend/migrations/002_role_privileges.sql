DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'esure_application') THEN
    GRANT USAGE ON SCHEMA public TO esure_application;
    GRANT SELECT ON schema_migrations, scenarios, scenario_versions TO esure_application;
    GRANT SELECT, INSERT ON runs, run_steps, assertion_results, idempotency_records TO esure_application;
    REVOKE UPDATE, DELETE, TRUNCATE ON scenario_versions FROM esure_application;
    REVOKE ALL ON cleanup_audit FROM esure_application;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'esure_worker') THEN
    GRANT USAGE ON SCHEMA public TO esure_worker;
    GRANT SELECT ON scenarios, scenario_versions TO esure_worker;
    GRANT SELECT, INSERT, UPDATE ON runs, run_steps TO esure_worker;
    GRANT SELECT, INSERT ON assertion_results TO esure_worker;
    REVOKE UPDATE, DELETE, TRUNCATE ON scenario_versions FROM esure_worker;
    REVOKE ALL ON cleanup_audit FROM esure_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'esure_maintenance') THEN
    GRANT USAGE ON SCHEMA public TO esure_maintenance;
    GRANT SELECT, DELETE ON runs, run_steps, assertion_results, idempotency_records, scenarios, scenario_versions TO esure_maintenance;
    GRANT SELECT, INSERT ON cleanup_audit TO esure_maintenance;
    GRANT USAGE, SELECT ON SEQUENCE cleanup_audit_id_seq TO esure_maintenance;
    GRANT EXECUTE ON FUNCTION reject_scenario_version_mutation() TO esure_maintenance;
    GRANT EXECUTE ON FUNCTION guard_run_cleanup(), guard_scenario_cleanup() TO esure_maintenance;
    REVOKE UPDATE, TRUNCATE ON scenario_versions FROM esure_maintenance;
  END IF;
END $$;
