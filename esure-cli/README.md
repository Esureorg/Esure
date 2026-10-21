# ESURE CLI

Command-line interface for running Stellar Testnet scenario tests.

## Installation

```bash
cd esure-cli
npm install
npm run build
```

## Usage

### List bundled scenarios

```bash
npx esure list
```

### Validate a scenario file

```bash
npx esure validate ./my-scenario.yaml
npx esure validate ./my-scenario.json
```

### Run a bundled scenario

```bash
npx esure run xlm-payment
npx esure run issued-asset-payment
```

### Run a scenario from file

```bash
npx esure run ./my-scenario.yaml
npx esure run ./my-scenario.json
```

### JSON output

```bash
npx esure list --output json
npx esure validate ./my-scenario.yaml --output json
npx esure run xlm-payment --output json
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
        run: npx esure run ./scenarios/payment-test.yaml --output json
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

### `esure run <target>`

Executes a scenario on Stellar Testnet.

**Arguments:**
- `<target>`: Bundled scenario ID (e.g., `xlm-payment`) or path to scenario file

**Options:**
- `--output json`: Output execution report in JSON format

**Exit codes:**
- `0`: All steps and assertions passed
- `1`: One or more steps or assertions failed, or execution error

## Examples

```bash
# List available scenarios
npx esure list

# Validate local scenario
npx esure validate ./tests/trustline-test.yaml

# Run bundled scenario
npx esure run insufficient-xlm-balance

# Run custom scenario with JSON output
npx esure run ./tests/custom.yaml --output json

# CI integration
npx esure run ./scenarios/integration.yaml && echo "Tests passed!"
```

## Output Formats

### Human-readable output (default)

```
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
