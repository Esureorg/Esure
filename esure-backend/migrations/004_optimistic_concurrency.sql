ALTER TABLE runs
  ADD COLUMN version integer NOT NULL DEFAULT 0;

CREATE INDEX runs_version_idx ON runs (version);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'esure_application') THEN
    GRANT SELECT, INSERT, UPDATE ON runs TO esure_application;
  END IF;
END $$;