# ESURE CLI

Command-line interface for running Stellar Testnet scenario tests.

## Installation

```bash
cd esure-cli
npm ci
npm run build
```

The CLI is not published to npm yet. The commands below use the built entry
point directly so they work from this repository checkout.

## Usage

### List bundled scenarios

```bash
node ./dist/cli.js list
```

### Validate a scenario file

```bash
node ./dist/cli.js validate ./my-scenario.yaml
node ./dist/cli.js validate ./my-scenario.json
```

### Validate an archived JSON report offline

```bash
npx esure report validate ./run-report.json
npx esure report validate ./run-report.json --output json
```

This command reads at most 5 MiB, checks the backend's maintained run-report
contract, and never executes imported content or makes network requests.
`--output json` writes successful results to stdout and failures to stderr.

### Run a bundled scenario

```bash
node ./dist/cli.js run xlm-payment
node ./dist/cli.js run issued-asset-payment
```

### Run a scenario from file

```bash
node ./dist/cli.js run ./my-scenario.yaml
node ./dist/cli.js run ./my-scenario.json
```

### JSON output

```bash
node ./dist/cli.js list --output json
node ./dist/cli.js validate ./my-scenario.yaml --output json
node ./dist/cli.js run xlm-payment --output json
```

## Common Workflows

The examples below assume the CLI has been built as described in
[Installation](#installation), and commands are run from the `esure-cli`
directory.
Each run executes against Stellar Testnet and may create temporary Testnet
accounts. If running from the repository root instead, prefix the CLI path
with `./esure-cli/`.

### Run every bundled scenario in sequence

Use this in a scheduled or manual Testnet sweep when you want every bundled
scenario attempted, even if an earlier one fails. `jq` reads the bundled IDs
from the CLI, and the loop returns a failing exit code if any run fails.

```bash
set -euo pipefail
scenario_ids=$(
  node ./dist/cli.js list --output json \
    | jq -r '.scenarios[].id'
) || exit 1
failures=""

while IFS= read -r scenario; do
  [ -n "$scenario" ] || continue
  if node ./dist/cli.js run "$scenario"; then
    printf 'PASS %s\n' "$scenario"
  else
    status=$?
    printf 'FAIL %s (exit %s)\n' "$scenario" "$status" >&2
    failures="${failures}${failures:+, }${scenario}"
  fi
done <<EOF
$scenario_ids
EOF

if [ -n "$failures" ]; then
  printf 'Failed scenarios: %s\n' "$failures" >&2
  exit 1
fi
```

Some bundled scenarios intentionally test rejected operations. Check their
reports when interpreting a nonzero exit status; the CLI returns failure when
an execution step fails, even if that failure is the behavior the scenario
tests.

### Extract transaction hashes from JSON

Use machine-readable output when a later script needs transaction hashes.
`--output json` sends the run report to standard output; `jq` prints only hashes
that are present in successful step results.

```bash
set -o pipefail
node ./dist/cli.js run xlm-payment --output json \
  | jq -r '.steps[]?.transactionHash // empty'
```

### Fail CI when a scenario fails

Use the CLI's exit status directly in a CI step. It returns `1` when a run
fails, an assertion fails, or execution errors, so the job fails without
parsing human-readable output.

```bash
node ./dist/cli.js run-suite xlm-payment issued-asset-payment path-payment
```

To keep going after a failed scenario and report the rest of the suite, omit
`--fail-fast` (as above). Add `--fail-fast` to stop on the first failure.

### Save a timestamped JSON report

Use `--report-file` to retain a structured report as a CI artifact or local
diagnostic. The timestamp avoids overwriting prior runs; reports contain
execution results, so store them according to your project's artifact policy.

```bash
mkdir -p reports
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
node ./dist/cli.js run issued-asset-payment \
  --report-file "reports/${timestamp}-issued-asset-payment.json"
```

### Validate staged custom scenarios before committing

Use this as `.git/hooks/pre-commit` in a repository that keeps custom scenario
files under `custom-scenarios/`. It validates staged additions and modifications
and blocks the commit if any scenario is invalid. Build the CLI before using the
hook.

```bash
#!/usr/bin/env bash
set -euo pipefail

files=$(git diff --cached --name-only --diff-filter=ACMR -- \
  'custom-scenarios/*.yaml' \
  'custom-scenarios/*.yml' \
  'custom-scenarios/*.json')

if [ -z "$files" ]; then
  exit 0
fi

while IFS= read -r file; do
  [ -n "$file" ] || continue
  printf 'Validating %s\n' "$file"
  node ./esure-cli/dist/cli.js validate "$file"
done <<EOF
$files
EOF
```

## CI Integration

The CLI returns proper exit codes for use in CI pipelines:

- `0`: Success (scenario passed or validation succeeded)
- `1`: Failure (scenario failed, validation failed, or error occurred)

### GitHub Actions Example

```yaml
name: Test Stellar Integration

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install ESURE CLI
        run: |
          cd esure-cli
          npm ci
          npm run build
      - name: Run Stellar tests
        run: node ./dist/cli.js run xlm-payment --output json
```

## Security

ESURE CLI is restricted to Stellar Testnet only. It rejects:

- Mainnet network configurations
- Secret seeds in scenario files
- URLs and arbitrary scripts
- Raw XDR or transaction envelopes
- Unsafe scenario properties

Generated Testnet secrets remain ephemeral and are never persisted.

## Commands

### `esure list`

Lists all bundled scenarios available in ESURE.

**Options:**

- `--output json`: Output in JSON format

### `esure validate <file>`

Validates a scenario file without executing it.

**Arguments:**

- `<file>`: Path to .json, .yaml, or .yml scenario file

**Options:**

- `--output json`: Output validation result in JSON format

**Exit codes:**

- `0`: Valid scenario
- `1`: Invalid scenario or validation error

### `esure report validate <file>`

Validates an archived JSON run report against the backend's maintained report
contract without network access or scenario execution. Files larger than 5 MiB
are rejected.

**Options:**
- `--output json`: Output the validation result in JSON format

**Exit codes:**
- `0`: Valid report
- `1`: Invalid, unreadable, unsupported, or oversized report

### `esure run <target>`

Executes a scenario on Stellar Testnet.

**Arguments:**

- `<target>`: Bundled scenario ID (e.g., `xlm-payment`) or path to scenario file

**Options:**
- `--output, -o json`: Output execution report in JSON format
- `--timeout-ms <ms>`: Overall run timeout in milliseconds (default: 120000)
- `--ascii`: Use ASCII status markers (PASS/FAIL) instead of Unicode glyphs

**Exit codes:**

- `0`: All steps and assertions passed
- `1`: One or more steps or assertions failed, execution error, or run timeout
- `130`: Interrupted by SIGINT
- `143`: Terminated by SIGTERM

When `--output json` is requested, argument errors and cancellation responses are emitted to `stderr` in a structured JSON error envelope (`{"error": {"code": "...", "message": "..."}}`).

### `esure run-suite <id> [<id>...]`

Runs multiple bundled scenarios sequentially.

**Arguments:**
- `<id>...`: Bundled scenario IDs to run

**Options:**
- `--fail-fast`: Stop after first failure
- `--output json`: Output in JSON format

---

### `esure completions <shell>`

Generate shell command completions for Bash or Zsh.

**Arguments:**
- `<shell>`: `bash` or `zsh`

**Examples:**

```bash
# Bash completion
esure completions bash > /etc/bash_completion.d/esure
# or source in your shell:
source <(esure completions bash)

# Zsh completion
esure completions zsh > /usr/local/share/zsh/site-functions/_esure
# or source in your shell:
source <(esure completions zsh)
```

---

### `esure doctor`

Diagnose the local installation. Checks for the compiled CLI build artifact,
the backend package, and a supported Node.js version.

```bash
esure doctor
```

Exit code is `0` when all checks pass, `1` otherwise.

## Examples

```bash
# List available scenarios
node ./dist/cli.js list

# Validate local scenario
node ./dist/cli.js validate ./tests/trustline-test.yaml

# Run bundled scenario
node ./dist/cli.js run insufficient-xlm-balance

# Run custom scenario with JSON output
node ./dist/cli.js run ./tests/custom.yaml --output json

# CI integration
node ./dist/cli.js run xlm-payment && echo "Tests passed!"
```

## Output Formats

### Human-readable output (default)

```text
Running scenario: XLM payment
ID: xlm-payment (v1)

Steps:
  ✓ fund-accounts: Test accounts funded.
  ✓ send-xlm: Confirmed.
    Tx: abc123...

Assertions:
  ✓ balanceChangedBy: Balance for recipient/xlm changed by 5.

Result: PASSED
  Steps: 2/2 passed
  Assertions: 1/1 passed
```

### JSON output (`--output json`)

```json
{
  "scenarioId": "xlm-payment",
  "scenarioVersion": 1,
  "status": "passed",
  "steps": [...],
  "assertions": [...],
  "summary": {
    "stepsPassed": 2,
    "stepsFailed": 0,
    "assertionsPassed": 1,
    "assertionsFailed": 0
  }
}
```

## Development

```bash
# Run in development mode
npm run dev -- list

# Run tests
npm test

# Type check
npm run typecheck

# Build
npm run build
```
