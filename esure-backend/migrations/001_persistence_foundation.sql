CREATE TABLE scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_slug text UNIQUE,
  origin text NOT NULL CHECK (origin IN ('bundled', 'operator', 'anonymous_inline')),
  submitted_scenario_id text,
  visibility text NOT NULL CHECK (visibility IN ('published', 'unlisted')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((origin IN ('bundled', 'operator') AND public_slug IS NOT NULL AND visibility = 'published') OR
         (origin = 'anonymous_inline' AND public_slug IS NULL AND visibility = 'unlisted'))
);

CREATE TABLE scenario_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id uuid NOT NULL REFERENCES scenarios(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  source_format text NOT NULL CHECK (source_format IN ('json', 'yaml')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (scenario_id, version_number),
  UNIQUE (scenario_id, content_hash)
);

CREATE TABLE runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_version_id uuid NOT NULL REFERENCES scenario_versions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  network text NOT NULL CHECK (network = 'testnet'),
  status text NOT NULL CHECK (status IN ('requested', 'claimed', 'running', 'passed', 'failed', 'interrupted', 'cancelled')),
  lease_owner uuid,
  lease_epoch bigint NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  error jsonb,
  CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
  CHECK ((status IN ('passed', 'failed', 'interrupted', 'cancelled')) = (completed_at IS NOT NULL))
);

CREATE TABLE run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  step_index integer NOT NULL CHECK (step_index >= 0),
  step_id text NOT NULL,
  step_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'prepared', 'submitted', 'passed', 'failed', 'interrupted')),
  transaction_hash text CHECK (transaction_hash IS NULL OR transaction_hash ~ '^[0-9a-f]{64}$'),
  ledger_sequence bigint CHECK (ledger_sequence IS NULL OR ledger_sequence >= 0),
  stellar_transaction_code text,
  stellar_operation_codes jsonb CHECK (stellar_operation_codes IS NULL OR jsonb_typeof(stellar_operation_codes) = 'array'),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (run_id, step_index),
  UNIQUE (run_id, step_id),
  CHECK (status NOT IN ('prepared', 'submitted') OR transaction_hash IS NOT NULL)
);

CREATE TABLE assertion_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  assertion_index integer NOT NULL CHECK (assertion_index >= 0),
  assertion_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('passed', 'failed')),
  expected jsonb NOT NULL,
  actual jsonb NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (run_id, assertion_index)
);

CREATE TABLE idempotency_records (
  key_hash text PRIMARY KEY CHECK (key_hash ~ '^hmac-sha256:[0-9a-f]{64}$'),
  endpoint text NOT NULL,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  run_id uuid NOT NULL UNIQUE REFERENCES runs(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE TABLE cleanup_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cleanup_id uuid NOT NULL,
  actor text NOT NULL DEFAULT current_user,
  action text NOT NULL CHECK (action IN ('delete_run', 'delete_scenario_version', 'delete_scenario')),
  target_table text NOT NULL,
  target_id uuid NOT NULL,
  reason text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX scenarios_published_catalogue_idx ON scenarios (public_slug) WHERE visibility = 'published' AND status = 'active';
CREATE INDEX scenario_versions_history_idx ON scenario_versions (scenario_id, version_number DESC);
CREATE INDEX runs_scenario_history_idx ON runs (scenario_version_id, created_at DESC, id DESC);
CREATE INDEX runs_claim_idx ON runs (created_at, id) WHERE status = 'requested';
CREATE INDEX runs_lease_idx ON runs (lease_expires_at) WHERE status IN ('claimed', 'running');
CREATE INDEX run_steps_transaction_hash_idx ON run_steps (transaction_hash) WHERE transaction_hash IS NOT NULL;
CREATE INDEX idempotency_expiry_idx ON idempotency_records (expires_at);
CREATE INDEX cleanup_audit_cleanup_idx ON cleanup_audit (cleanup_id, occurred_at);

CREATE FUNCTION reject_scenario_version_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('esure.cleanup_mode', true) = 'on'
     AND pg_has_role(current_user, to_regrole('esure_maintenance'), 'member')
     AND OLD.created_at < clock_timestamp() - interval '30 days'
     AND EXISTS (SELECT 1 FROM scenarios WHERE id = OLD.scenario_id AND origin = 'anonymous_inline')
     AND NOT EXISTS (SELECT 1 FROM runs WHERE scenario_version_id = OLD.id) THEN
    IF EXISTS (SELECT 1 FROM cleanup_audit WHERE cleanup_id::text = current_setting('esure.cleanup_id', true)
      AND action = 'delete_scenario_version' AND target_table = 'scenario_versions' AND target_id = OLD.id) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'scenario versions are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION guard_run_cleanup() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('esure.cleanup_mode', true) = 'on'
     AND pg_has_role(current_user, to_regrole('esure_maintenance'), 'member')
     AND OLD.status IN ('passed', 'failed', 'interrupted', 'cancelled')
     AND OLD.completed_at < clock_timestamp() - interval '30 days'
     AND EXISTS (SELECT 1 FROM cleanup_audit WHERE cleanup_id::text = current_setting('esure.cleanup_id', true)
       AND action = 'delete_run' AND target_table = 'runs' AND target_id = OLD.id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'run is not eligible for cleanup' USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION guard_scenario_cleanup() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('esure.cleanup_mode', true) = 'on'
     AND pg_has_role(current_user, to_regrole('esure_maintenance'), 'member')
     AND OLD.origin = 'anonymous_inline'
     AND OLD.created_at < clock_timestamp() - interval '30 days'
     AND NOT EXISTS (SELECT 1 FROM scenario_versions WHERE scenario_id = OLD.id)
     AND EXISTS (SELECT 1 FROM cleanup_audit WHERE cleanup_id::text = current_setting('esure.cleanup_id', true)
       AND action = 'delete_scenario' AND target_table = 'scenarios' AND target_id = OLD.id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'scenario is not eligible for cleanup' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER scenario_versions_immutable
BEFORE UPDATE OR DELETE ON scenario_versions
FOR EACH ROW EXECUTE FUNCTION reject_scenario_version_mutation();

CREATE TRIGGER runs_cleanup_guard BEFORE DELETE ON runs
FOR EACH ROW EXECUTE FUNCTION guard_run_cleanup();

CREATE TRIGGER scenarios_cleanup_guard BEFORE DELETE ON scenarios
FOR EACH ROW EXECUTE FUNCTION guard_scenario_cleanup();

REVOKE ALL ON FUNCTION reject_scenario_version_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION guard_run_cleanup() FROM PUBLIC;
REVOKE ALL ON FUNCTION guard_scenario_cleanup() FROM PUBLIC;
