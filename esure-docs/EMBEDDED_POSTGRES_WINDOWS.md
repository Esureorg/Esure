# Embedded PostgreSQL integration tests on Windows

Some backend integration tests use `embedded-postgres` to start a temporary
PostgreSQL server. On Windows, those suites are skipped automatically when the
Visual C++ runtime required by the embedded PostgreSQL binaries is not
available.

## Skip condition

In
[`esure-backend/test/postgres-run-store.integration.test.ts`](../esure-backend/test/postgres-run-store.integration.test.ts),
the test suite is enabled only when:

- the process is not running on Windows, or
- `C:\Windows\System32\VCRUNTIME140.dll` exists, or
- `node_modules\@embedded-postgres\windows-x64\native\bin\VCRUNTIME140.dll`
  exists relative to the backend package.

If none of these conditions is true on Windows, the file registers the suite as
skipped:

```ts
(postgresAvailable ? describe.sequential : describe.skip)("PostgresRunStore", () => {
  // ...
});
```

The same runtime check is used by
[`esure-backend/test/database.integration.test.ts`](../esure-backend/test/database.integration.test.ts)
for the `PostgreSQL persistence foundation` suite.

## How to identify the skip in test output

Run the backend tests as usual (`npm test` from `esure-backend`). When the
runtime is missing on Windows, Vitest does not fail these suites; it reports
them as skipped.

Look for:

- the suite name `PostgresRunStore` (and/or `PostgreSQL persistence foundation`)
  marked as skipped in the Vitest output, and
- skipped tests/files in the final summary (for example, a non-zero skipped
  count rather than failures for these embedded PostgreSQL suites).

If the suites are not skipped, Vitest will attempt to initialise and start the
embedded PostgreSQL instances defined in those integration tests.

## Supported runtime setup without bundling binaries

Install a supported Microsoft Visual C++ runtime on Windows instead of bundling
native binaries in this repository.

1. Install the latest supported **Microsoft Visual C++ Redistributable for
   Visual Studio 2015-2022 (x64)** from Microsoft.
2. Confirm that `C:\Windows\System32\VCRUNTIME140.dll` is present after
   installation.
3. Ensure backend dependencies are installed in `esure-backend` (`npm install`).
4. Open a new terminal session if needed, then rerun the integration test.

This repository does not ship `VCRUNTIME140.dll` or embedded PostgreSQL
binaries as project artifacts; the test detects an installed/runtime-provided
copy.

## Rerun the integration test

From the `esure-backend` directory, rerun only the Postgres run-store
integration test:

```powershell
npm test -- test/postgres-run-store.integration.test.ts
```

This command uses the backend `vitest run` test script with a file filter. If
the Windows runtime requirement is satisfied, the `PostgresRunStore` suite
should execute instead of being skipped.
