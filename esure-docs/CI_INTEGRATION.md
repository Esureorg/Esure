# ESURE CI Integration Guide

ESURE CLI can be integrated into continuous integration pipelines to automatically
test Stellar payment flows, trustline behavior, and transaction handling on Testnet.

## Quick Start

```yaml
# .github/workflows/stellar-tests.yml
name: Stellar Integration Tests

on: [push, pull_request]

jobs:
  test-stellar:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      
      - name: Install ESURE
        run: |
          cd esure-cli
          npm ci
          npm run build
      
      - name: Run Stellar scenario tests
        run: |
          npx esure run ./scenarios/payment-flow.yaml --output json
```

## Exit Codes

ESURE CLI returns proper exit codes for CI integration:

- **0**: Success - All steps and assertions passed
- **1**: Failure - One or more steps/assertions failed, validation error, or execution error

CI pipelines automatically fail when exit code is non-zero.

## JSON Output for Parsing

Use `--output json` to get machine-readable results:

```bash
npx esure run xlm-payment --output json
```

### Success Output

```json
{
  "scenarioId": "xlm-payment",
  "scenarioVersion": 1,
  "status": "passed",
  "steps": [
    {
      "id": "fund-accounts",
      "type": "fundAccounts",
      "status": "passed",
      "message": "Test accounts funded."
    },
    {
      "id": "send-xlm",
      "type": "payment",
      "status": "passed",
      "transactionHash": "abc123...",
      "ledger": 12345,
      "message": "Confirmed."
    }
  ],
  "assertions": [
    {
      "type": "balanceChangedBy",
      "status": "passed",
      "expected": "5",
      "actual": "5",
      "message": "Balance for recipient/xlm changed by 5."
    }
  ],
  "summary": {
    "stepsPassed": 2,
    "stepsFailed": 0,
    "assertionsPassed": 1,
    "assertionsFailed": 0
  }
}
```

### Failure Output

```json
{
  "scenarioId": "insufficient-balance",
  "scenarioVersion": 1,
  "status": "failed",
  "steps": [...],
  "assertions": [...],
  "summary": {
    "stepsPassed": 1,
    "stepsFailed": 1,
    "assertionsPassed": 0,
    "assertionsFailed": 1
  }
}
```

## Complete GitHub Actions Examples

### Single Scenario Test

```yaml
name: Test Payment Flow

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
        working-directory: ./esure-cli
        run: |
          npm ci
          npm run build
      
      - name: Run payment scenario
        run: npx esure run ./tests/payment-integration.yaml
```

### Multiple Scenario Matrix

```yaml
name: Stellar Integration Test Suite

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        scenario:
          - xlm-payment
          - issued-asset-payment
          - missing-trustline
          - insufficient-xlm-balance
          - trustline-limit-exceeded
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      
      - name: Install ESURE CLI
        working-directory: ./esure-cli
        run: |
          npm ci
          npm run build
      
      - name: Run ${{ matrix.scenario }}
        run: npx esure run ${{ matrix.scenario }} --output json
```

### Custom Scenarios Directory

```yaml
name: Custom Stellar Tests

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
        working-directory: ./esure-cli
        run: |
          npm ci
          npm run build
      
      - name: Run all custom scenarios
        run: |
          for scenario in tests/stellar/*.yaml; do
            echo "Testing $scenario..."
            npx esure run "$scenario" --output json || exit 1
          done
```

### With Test Reporting

```yaml
name: Stellar Tests with Reporting

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
        working-directory: ./esure-cli
        run: |
          npm ci
          npm run build
      
      - name: Run scenarios and capture results
        run: |
          npx esure run xlm-payment --output json > payment-result.json
          npx esure run missing-trustline --output json > trustline-result.json
      
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: stellar-test-results
          path: |
            *-result.json
```

## GitLab CI Example

```yaml
# .gitlab-ci.yml
test-stellar:
  image: node:20
  stage: test
  script:
    - cd esure-cli
    - npm ci
    - npm run build
    - npx esure run ./scenarios/payment-test.yaml --output json
  artifacts:
    when: always
    reports:
      dotenv: test-results.json
```

## CircleCI Example

```yaml
# .circleci/config.yml
version: 2.1

jobs:
  test-stellar:
    docker:
      - image: cimg/node:20.0
    steps:
      - checkout
      - run:
          name: Install ESURE CLI
          command: |
            cd esure-cli
            npm ci
            npm run build
      - run:
          name: Run Stellar tests
          command: npx esure run ./tests/stellar-integration.yaml --output json

workflows:
  test:
    jobs:
      - test-stellar
```

## Best Practices

### 1. Validate Before Running

```bash
# Validate scenario first
npx esure validate ./scenario.yaml || exit 1

# Then run
npx esure run ./scenario.yaml
```

### 2. Use Specific Scenario Files

Store integration test scenarios in version control:

```
tests/
  stellar/
    payment-flow.yaml
    trustline-setup.yaml
    error-handling.yaml
```

### 3. Set Explicit Expectations

Design scenarios with clear assertions:

```yaml
assertions:
  - type: balanceEquals
    account: recipient
    asset: xlm
    amount: "100"
  - type: stepSucceeded
    step: payment
  - type: transactionConfirmed
    step: payment
```

### 4. Handle Testnet Rate Limits

Space out runs or use retry logic for Testnet service unavailability:

```yaml
- name: Run with retry
  uses: nick-invision/retry@v2
  with:
    timeout_minutes: 2
    max_attempts: 3
    command: npx esure run ./scenario.yaml
```

### 5. Fail Fast vs Continue

**Fail Fast** (default):
```bash
npx esure run scenario1.yaml && \
npx esure run scenario2.yaml && \
npx esure run scenario3.yaml
```

**Continue on Failure**:
```bash
EXIT_CODE=0
npx esure run scenario1.yaml || EXIT_CODE=1
npx esure run scenario2.yaml || EXIT_CODE=1
npx esure run scenario3.yaml || EXIT_CODE=1
exit $EXIT_CODE
```

## Parsing JSON Output

### Shell Script

```bash
#!/bin/bash

RESULT=$(npx esure run xlm-payment --output json)
STATUS=$(echo "$RESULT" | jq -r '.status')

if [ "$STATUS" = "passed" ]; then
  echo "✓ Payment test passed"
  exit 0
else
  echo "✗ Payment test failed"
  echo "$RESULT" | jq '.summary'
  exit 1
fi
```

### JavaScript

```javascript
import { spawn } from 'child_process';

async function runScenario(scenarioId) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['esure', 'run', scenarioId, '--output', 'json']);
    let output = '';
    
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    child.on('close', (code) => {
      try {
        const result = JSON.parse(output);
        if (code === 0) {
          resolve(result);
        } else {
          reject(new Error(`Scenario failed: ${result.status}`));
        }
      } catch (error) {
        reject(error);
      }
    });
  });
}

// Usage
try {
  const result = await runScenario('xlm-payment');
  console.log(`✓ Passed: ${result.summary.assertionsPassed} assertions`);
} catch (error) {
  console.error(`✗ Failed: ${error.message}`);
  process.exit(1);
}
```

## Common Issues

### Friendbot Rate Limiting

**Symptom**: "Friendbot could not be reached" or HTTP 429 errors

**Solution**: 
- Add retry logic with backoff
- Reduce concurrent scenario runs
- Use scenarios that reuse funded accounts where possible

### Network Timeouts

**Symptom**: "Stellar network execution failed"

**Solution**:
- Increase timeout in CI configuration
- Verify Stellar Testnet service status
- Add retry logic

### Validation Failures

**Symptom**: Exit code 1 before execution starts

**Solution**:
- Run `npx esure validate <file>` locally first
- Check scenario schema compliance
- Ensure no Mainnet config, secrets, or URLs in scenarios

## Security Considerations

- Never commit secret seeds to scenario files
- ESURE CLI rejects scenarios with secrets or Mainnet config
- Generated Testnet keys are ephemeral and not persisted
- Scenario validation runs before any network access

## Performance

- Average scenario execution: 10-30 seconds
- Funding accounts: ~5-10 seconds
- Transaction submission: ~5 seconds
- Multiple scenarios: Run sequentially or use matrix strategy

## Support

For issues or questions:
- GitHub Issues: https://github.com/Esureorg/Esure/issues
- Documentation: https://github.com/Esureorg/Esure/tree/main/esure-docs
