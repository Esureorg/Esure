# ESURE Contributor Backlog

This document lists open engineering work suitable for external contributors during Stellar Wave campaigns. Each item represents genuine improvement work that strengthens ESURE's usefulness as a Stellar Testnet integration testing toolkit.

**Important**: This is an engineering backlog, not a commitment. Items may be reprioritized, combined, or deferred based on maintainer capacity and project direction.

---

## How to Contribute

1. Browse issues tagged with `good first issue`, `help wanted`, or `stellar wave`
2. Comment on an issue with your implementation approach
3. Wait for maintainer assignment before beginning work
4. Follow the acceptance criteria exactly as specified
5. Include tests and run `npm run check` before submitting

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for complete workflow details.

---

## CLI & Developer Tools

### Issue 1: Add CLI Unit Tests

**Difficulty**: Good first issue  
**Area**: Testing, CLI  
**Files**: `esure-cli/src/cli.ts`, `esure-cli/test/`

**Problem**:  
The CLI package has no automated tests. This makes it risky to refactor or extend CLI commands without manual verification.

**Why it matters**:  
Developers using ESURE in CI pipelines depend on stable CLI behavior. Automated tests catch regressions before they reach users.

**Scope**:  
Add unit tests for CLI commands: `list`, `validate`, and `run`. Mock file system and network calls. Verify exit codes, JSON output format, and error handling.

**Acceptance criteria**:
- [ ] Test `esure list` returns scenario catalog in human and JSON formats
- [ ] Test `esure validate` accepts valid YAML/JSON and rejects invalid scenarios
- [ ] Test `esure run` returns exit code 0 for passing scenarios, 1 for failures
- [ ] Test `--output json` produces parseable JSON for all commands
- [ ] Test CLI rejects Mainnet config and secret seeds
- [ ] All tests pass in `npm test` without hitting live Testnet services
- [ ] Test coverage for cli.ts exceeds 80%

**Testing requirements**:
- Use vitest for test runner (already configured)
- Mock `@esure/backend` dependencies to avoid Testnet calls
- Add tests to `esure-cli/test/cli.test.ts`
- Tests must run in CI without external dependencies

**Out of scope**:
- Integration tests hitting real Testnet
- CLI performance optimization
- New CLI commands
- Changes to CLI argument parsing

---

### Issue 2: Add Horizon API Retry Logic for Network Resilience

**Difficulty**: Medium  
**Area**: Backend, Reliability  
**Files**: `esure-backend/src/stellar-gateway.ts`

**Problem**:  
Horizon API calls (transaction submission, account loading) fail immediately on transient network errors. Users see "Network unavailable" errors even when retrying would succeed.

**Why it matters**:  
CI pipelines using ESURE need resilience against temporary Testnet unavailability. Automatic retries with backoff improve success rates without user intervention.

**Scope**:  
Add bounded exponential backoff retry logic to Horizon API calls (similar to existing Friendbot retry). Retry on 429 (rate limit), 503 (unavailable), and network timeout errors. Do not retry on 4xx client errors.

**Acceptance criteria**:
- [ ] Transaction submission retries up to 3 times on retryable errors
- [ ] Account loading retries up to 3 times on retryable errors
- [ ] Exponential backoff with jitter between retries (1s, 2s, 4s base delays)
- [ ] 4xx errors (except 429) do not retry
- [ ] Final error message indicates "failed after N retries"
- [ ] Retry config is testable without real waiting (inject clock/random)
- [ ] Unit tests verify retry behavior with fake Horizon responses
- [ ] Existing tests still pass

**Testing requirements**:
- Add tests to `esure-backend/test/stellar-gateway.test.ts`
- Mock Horizon server returning 503, then 200
- Verify retry count and final success/failure
- Test that 400 errors do not retry

**Out of scope**:
- Friendbot retry changes (already implemented)
- Retry logic for frontend polling
- User-configurable retry limits
- Circuit breaker pattern

---

### Issue 3: Implement Persistent Run History in PostgreSQL

**Difficulty**: Advanced  
**Area**: Backend, Persistence  
**Files**: `esure-backend/src/persistence.ts`, `esure-backend/migrations/`, `esure-backend/src/run-store.ts`

**Problem**:  
Run execution history is stored in memory and lost on server restart. Users cannot review past run results or analyze failure patterns over time.

**Why it matters**:  
Persistent run history enables debugging, trend analysis, and audit trails. Production deployments need durable storage beyond in-memory state.

**Scope**:  
Extend PostgreSQL persistence layer to save sanitized run reports. Add migration for `runs` table. Implement `PostgresRunStore` implementing `RunStore` interface. Ensure secrets are never persisted.

**Acceptance criteria**:
- [ ] Database migration creates `runs` table with schema: run_id, scenario_id, scenario_version, status, created_at, completed_at, duration_ms, steps (jsonb), assertions (jsonb), summary (jsonb), error (jsonb)
- [ ] `PostgresRunStore` class implements `RunStore` interface
- [ ] Runs persist across server restarts when `PERSISTENCE_MODE=full`
- [ ] Secrets and account keys are never saved to database
- [ ] Migration is reversible (add `down` migration)
- [ ] New config option `RUN_PERSISTENCE_ENABLED` defaults to false
- [ ] Integration tests verify persistence with embedded-postgres
- [ ] Existing in-memory store remains default behavior
- [ ] API response format unchanged (backward compatible)

**Testing requirements**:
- Add `esure-backend/test/postgres-run-store.integration.test.ts`
- Test create, get, update, and expiration
- Verify secrets are redacted before persistence
- Test migration up and down
- Run persistence tests in CI

**Out of scope**:
- Run history pagination API
- Run history dashboard UI
- Run history analytics or aggregation
- Run history search or filtering
- Migration from in-memory to PostgreSQL

---

## Stellar Scenarios

### Issue 4: Add Path Payment Stellar Scenario

**Difficulty**: Medium  
**Area**: Scenarios, Stellar Integration  
**Files**: `esure-backend/scenarios/path-payment.yaml`, `esure-docs/SCENARIOS.md`

**Problem**:  
ESURE supports only simple payments. Stellar's path payment operation (payment through multiple asset hops) is untested, but critical for DEX and liquidity applications.

**Why it matters**:  
Developers building DEX integrations or multi-asset wallets need to test path payments. This scenario demonstrates Stellar's cross-asset payment capabilities.

**Scope**:  
Create a path payment scenario: Alice pays Bob in USDC, but Alice only holds XLM. Payment routes through an XLM/USDC market maker. Verify Bob receives USDC.

**Acceptance criteria**:
- [ ] New scenario file `esure-backend/scenarios/path-payment.yaml`
- [ ] Scenario uses `pathPaymentStrictReceive` or `pathPaymentStrictSend` operation type
- [ ] Scenario involves at least 3 accounts: sender, market maker, recipient
- [ ] Path goes through at least one intermediary asset (XLM → issued asset)
- [ ] Assertions verify recipient receives correct destination asset amount
- [ ] Scenario passes when executed via dashboard or CLI
- [ ] Updated SCENARIOS.md documents path payment scenario
- [ ] Scenario validates against schema v1

**Testing requirements**:
- Scenario must execute successfully on Stellar Testnet
- Run `cd esure-backend && npm run check` to verify schema validation
- Test scenario via CLI: `npx esure run path-payment`
- Manually verify via dashboard

**Out of scope**:
- Path payment finder or optimization logic
- Multiple path payment scenarios
- Path payment failure scenarios
- Changes to scenario schema to support path payments (use existing operations)

**Note**: Current schema supports `payment` and `changeTrust` operations. This issue requires discussion on schema extension for path payments. Contributor should propose schema changes in issue comment before implementation.

---

### Issue 5: Add Stellar Offer/Trade Scenario

**Difficulty**: Medium  
**Area**: Scenarios, Stellar Integration  
**Files**: `esure-backend/scenarios/create-offer.yaml`, `esure-docs/SCENARIOS.md`

**Problem**:  
ESURE has no scenarios testing Stellar's decentralized exchange (manage offers, passive offers, or trades). DEX developers cannot test orderbook interaction.

**Why it matters**:  
DEX builders, market makers, and trading applications need to test offer creation and matching. This scenario demonstrates core Stellar DEX functionality.

**Scope**:  
Create a scenario where Alice creates a sell offer (100 USDC for XLM at 2:1 ratio), Bob creates a matching buy offer, trade executes, and both verify received assets.

**Acceptance criteria**:
- [ ] New scenario file `esure-backend/scenarios/create-offer.yaml`
- [ ] Scenario creates at least one offer using `manageBuyOffer` or `manageSellOffer`
- [ ] Scenario involves 2+ accounts and 2+ assets
- [ ] Assertions verify offer was created (check account offers via Horizon)
- [ ] Assertions verify trade execution (balance changes)
- [ ] Scenario handles partial fills or no-fill cases appropriately
- [ ] Scenario passes when executed
- [ ] Updated SCENARIOS.md with offer scenario documentation

**Testing requirements**:
- Execute scenario successfully on Testnet
- Verify via CLI and dashboard
- Run backend checks: `npm run check`

**Out of scope**:
- Multiple offer scenarios (limit orders, stop losses)
- Offer cancellation scenarios
- Complex orderbook analysis
- Schema changes for offer-specific assertions

**Note**: Like Issue 4, this may require schema extension discussion. Current schema may not support `manageOffer` operations. Contributor should clarify in issue comments.

---

### Issue 6: Add Stellar Data Entry Scenario

**Difficulty**: Good first issue  
**Area**: Scenarios, Stellar Integration  
**Files**: `esure-backend/scenarios/data-entry-simple.yaml`, `esure-docs/SCENARIOS.md`

**Problem**:  
ESURE scenarios don't test Stellar's `manageData` operation. Developers building apps that store key-value data on-chain cannot verify data entry behavior.

**Why it matters**:  
Applications using Stellar for data anchoring, identity, or metadata need to test data entry operations. This scenario is simpler than offers/path payments.

**Scope**:  
Create a scenario where an account writes a key-value pair using `manageData`, then verify the data exists on the account via assertions.

**Acceptance criteria**:
- [ ] New scenario file `esure-backend/scenarios/data-entry-simple.yaml`  
- [ ] Scenario uses `manageData` operation to set a key-value pair
- [ ] Scenario uses 1 account and native XLM asset
- [ ] Assertions verify data entry exists on account (may require new assertion type or external check)
- [ ] Scenario passes when executed
- [ ] Updated SCENARIOS.md with data entry scenario
- [ ] Schema validation passes

**Testing requirements**:
- Execute scenario on Testnet
- Verify via CLI: `npx esure run data-entry-simple`
- Backend tests pass: `npm run check`

**Out of scope**:
- Data deletion scenarios
- Multiple data entries per scenario
- Binary data encoding (use simple string values)
- Schema changes (discuss if manageData not supported)

**Note**: Current schema may not support `manageData`. Contributor should verify schema support or propose minimal extension.

---

## Frontend

### Issue 7: Add Scenario Filtering by Operation Type

**Difficulty**: Medium  
**Area**: Frontend, UX  
**Files**: `esure-frontend/src/components/dashboard.tsx`, `esure-frontend/src/components/dashboard.test.tsx`

**Problem**:  
With 10+ scenarios in the catalog, users cannot filter by scenario type (XLM payment, trustline, failure). They must scroll through all scenarios.

**Why it matters**:  
As scenario count grows, filtering improves discoverability. Users testing trustlines want to see only trustline-related scenarios.

**Scope**:  
Add client-side filter controls above scenario list. Filter by operation types: "All", "XLM Payments", "Issued Assets", "Trustlines", "Expected Failures". Update available count.

**Acceptance criteria**:
- [ ] Filter controls appear above scenario list with 5 options
- [ ] Selecting a filter shows only matching scenarios
- [ ] "Available scenarios" count updates to show filtered count
- [ ] Filter works with keyboard navigation (tab, arrow keys, enter)
- [ ] Filter state persists during run lifecycle (does not reset when run starts)
- [ ] Empty filter state shows helpful message ("No scenarios match this filter")
- [ ] Filter is tested in `dashboard.test.tsx` with React Testing Library
- [ ] Filter does not require backend API changes
- [ ] Accessible to screen readers (proper ARIA labels)

**Testing requirements**:
- Add unit tests for filter logic in `dashboard.test.tsx`
- Test filtering by each category
- Test "All" resets filter
- Test empty results state
- Run `npm run check` in esure-frontend

**Out of scope**:
- Search by scenario name
- Sorting (alphabetical, recent, etc.)
- Filter by scenario ID or version
- Backend API parameter for filtering
- Persisting filter to URL or localStorage

---

### Issue 8: Add Copy-to-Clipboard for Run IDs and Transaction Hashes

**Difficulty**: Good first issue  
**Area**: Frontend, UX  
**Files**: `esure-frontend/src/components/dashboard.tsx`, `esure-frontend/src/components/dashboard.test.tsx`

**Problem**:  
Users cannot easily copy run IDs or transaction hashes from the dashboard. They must manually select text, which is error-prone for long hex strings.

**Why it matters**:  
Users need to share run IDs for debugging or paste transaction hashes into Stellar Expert. Copy buttons improve usability.

**Scope**:  
Add copy button next to run ID in report header and next to each transaction hash in steps. Use browser Clipboard API. Show success feedback.

**Acceptance criteria**:
- [ ] Copy button appears next to run ID in report header
- [ ] Copy button appears next to each transaction hash in step results
- [ ] Clicking button copies text to clipboard
- [ ] Success feedback shown (button text changes to "Copied!" for 2 seconds)
- [ ] Copy failure handled gracefully (show "Failed to copy" message)
- [ ] Copy button accessible via keyboard (tab and enter)
- [ ] Copy button has accessible label for screen readers ("Copy run ID", "Copy transaction hash")
- [ ] Component tested in `dashboard.test.tsx`
- [ ] Tests verify button click triggers navigator.clipboard.writeText

**Testing requirements**:
- Add unit tests mocking navigator.clipboard API
- Test copy success and failure paths
- Test success feedback state
- Run `npm run check`

**Out of scope**:
- Copy buttons for other fields (balances, amounts, etc.)
- Copy entire report to clipboard
- Copy as markdown or formatted text
- Download report feature

---

### Issue 9: Display Run Duration and Timestamps in Reports

**Difficulty**: Medium  
**Area**: Frontend, UX  
**Files**: `esure-frontend/src/components/dashboard.tsx`, `esure-frontend/src/components/dashboard.test.tsx`

**Problem**:  
Reports show run status but not when the run started, completed, or how long it took. Users cannot tell if a run is stalled or compare execution times.

**Why it matters**:  
Duration and timestamps help debug performance issues and identify Testnet slowness. CI users need duration for SLA monitoring.

**Scope**:  
Display created timestamp, completed timestamp, and calculated duration in report summary section. Format timestamps in user's browser locale. Show ISO 8601 in title attribute for precision.

**Acceptance criteria**:
- [ ] Report summary shows "Created:" with timestamp
- [ ] Report summary shows "Completed:" with timestamp (if run is terminal)
- [ ] Report summary shows "Duration:" with elapsed time (if run is terminal)
- [ ] Timestamps formatted using browser locale (e.g., `toLocaleString()`)
- [ ] Timestamp hover/title shows ISO 8601 format for copy-paste
- [ ] Running runs show created time but not completed time
- [ ] Duration calculated as `completedAt - createdAt` in human-readable format (e.g., "2.4s", "1m 34s")
- [ ] Component tests verify timestamp rendering
- [ ] No backend API changes required (data already in RunReport)

**Testing requirements**:
- Add tests for timestamp formatting
- Test with terminal and non-terminal runs
- Test duration calculation
- Run `npm run check`

**Out of scope**:
- Step-level timestamps
- Time-to-first-byte metrics
- Time zone selection
- Relative time ("2 minutes ago")

---

## Documentation & Tooling

### Issue 10: Create Soroban Contract Testing Design Proposal

**Difficulty**: Advanced  
**Area**: Documentation, Architecture, Future Work  
**Files**: `esure-contracts/PROPOSAL.md`

**Problem**:  
ESURE supports Stellar classic operations but not Soroban smart contracts. The contracts directory exists but has no concrete design. Contributors don't know how to extend ESURE for Soroban.

**Why it matters**:  
Soroban is Stellar's smart contract platform. Developers building Soroban apps need integration testing tools similar to ESURE's classic scenarios.

**Scope**:  
Write a technical design proposal (not implementation) for how ESURE could test Soroban contracts. Address: contract deployment scenarios, contract invocation, event assertions, WASM artifact handling, and security boundaries.

**Acceptance criteria**:
- [ ] New file `esure-contracts/PROPOSAL.md` following template below
- [ ] Proposal explains the testing problem Soroban developers face
- [ ] Proposal describes at least 2 concrete scenario examples (e.g., deploy-token-contract, invoke-transfer)
- [ ] Proposal addresses how WASM artifacts are handled (upload, reference, or inline)
- [ ] Proposal addresses Soroban-specific assertions (event emitted, contract state, invocation result)
- [ ] Proposal maintains Testnet-only boundary (no Mainnet)
- [ ] Proposal explains how contract scenarios fit existing scenario schema or require schema v2
- [ ] Proposal discusses security implications (arbitrary WASM execution, resource limits)
- [ ] Proposal lists open questions and tradeoffs
- [ ] Proposal does NOT include implementation code
- [ ] Proposal reviewed by maintainer before merge

**Proposal template**:
```markdown
# Soroban Contract Testing Proposal

## Problem Statement
[What Soroban testing gap does this address?]

## Proposed Scenarios
[2-3 concrete scenario examples with pseudo-YAML]

## Architecture
[How do contract scenarios fit into ESURE?]

## Contract Artifact Handling
[How are WASM files referenced/uploaded/stored?]

## Soroban-Specific Assertions
[What new assertion types are needed?]

## Security & Safety
[Resource limits, sandboxing, Testnet-only enforcement]

## Schema Considerations
[Does this require scenario schema v2?]

## Open Questions
[Unresolved design decisions]

## Out of Scope
[What this proposal does NOT address]
```

**Testing requirements**:
- No code implementation required
- Markdown linting: run `npx markdownlint esure-contracts/PROPOSAL.md`

**Out of scope**:
- Soroban contract implementation
- Changes to scenario schema
- Changes to backend runner
- WASM compilation or upload

---

### Issue 11: Improve Network Timeout Error Messages

**Difficulty**: Good first issue  
**Area**: Backend, Developer Experience  
**Files**: `esure-backend/src/stellar-gateway.ts`, `esure-backend/src/errors.ts`

**Problem**:  
When Horizon or Friendbot times out, users see generic "Network unavailable" errors. They don't know which service failed or whether to retry.

**Why it matters**:  
Clear error messages reduce debugging time. Users need to know if Friendbot is down vs. Horizon is slow vs. their network is broken.

**Scope**:  
Improve error messages for network timeouts to specify which service failed (Friendbot, Horizon transaction submission, Horizon account loading) and suggest retry.

**Acceptance criteria**:
- [ ] Friendbot timeout errors say "Friendbot did not respond in time" instead of generic "Network unavailable"
- [ ] Horizon transaction timeout errors say "Horizon transaction submission timed out"
- [ ] Horizon account loading timeout errors say "Horizon account loading timed out"
- [ ] Error messages include suggestion: "This may be a temporary Testnet issue. Try again."
- [ ] Error category remains "network" for all timeout errors
- [ ] Existing error handling tests updated for new messages
- [ ] No change to error codes or API response structure

**Testing requirements**:
- Update tests in `esure-backend/test/stellar-gateway.test.ts`
- Add tests for new error messages
- Run `npm run check`

**Out of scope**:
- Automatic retries (handled by Issue 2)
- Network diagnostics or ping checks
- Horizon URL validation
- Error message internationalization

---

### Issue 12: Expand CLI Documentation with Examples

**Difficulty**: Good first issue  
**Area**: Documentation, CLI  
**Files**: `esure-cli/README.md`, `esure-docs/CI_INTEGRATION.md`

**Problem**:  
CLI README has basic usage but lacks real-world examples for common workflows (running multiple scenarios, parsing JSON output in scripts, handling failures).

**Why it matters**:  
Developers integrating ESURE into CI or scripts need copy-paste examples. Good examples reduce support burden.

**Scope**:  
Add "Common Workflows" section to CLI README with 5+ practical examples: run all scenarios in loop, parse JSON output with jq, fail CI on assertion failure, save results to file, validate custom scenarios in pre-commit hook.

**Acceptance criteria**:
- [ ] New "Common Workflows" section added to `esure-cli/README.md`
- [ ] At least 5 practical examples with working bash/shell code
- [ ] Examples cover: looping scenarios, JSON parsing, exit code handling, file output, validation
- [ ] Each example has brief explanation of when to use it
- [ ] Examples use realistic scenario names from bundled scenarios
- [ ] Examples tested on Linux/macOS (bash) and Windows (Git Bash)
- [ ] Updated `esure-docs/CI_INTEGRATION.md` cross-links to CLI examples
- [ ] No changes to CLI implementation code

**Example workflows to include**:
- Run all bundled scenarios in sequence
- Parse JSON output to extract transaction hashes
- Fail CI build if any scenario fails
- Save scenario results to timestamped file
- Validate custom scenario before committing

**Testing requirements**:
- Manually test each example command
- Verify examples work on Windows Git Bash
- Run `npx markdownlint esure-cli/README.md`

**Out of scope**:
- New CLI features
- CLI flag additions
- Video tutorials
- Interactive examples

---

## Summary

Total issues: 12  
- Good first issue: 5 (Issues 1, 6, 8, 11, 12)
- Medium: 5 (Issues 2, 4, 5, 7, 9)
- Advanced: 2 (Issues 3, 10)

**Areas covered**:
- **CLI & Tools**: 3 issues (testing, docs, retry)
- **Scenarios**: 3 issues (path payments, offers, data entries)
- **Frontend**: 3 issues (filtering, copy, timestamps)
- **Backend**: 2 issues (persistence, error messages)
- **Architecture**: 1 issue (Soroban design)

All issues represent genuine engineering work that improves ESURE without changing its Testnet-only mission or fabricating capabilities.

---

## Creating Issues on GitHub

Maintainers: Use these templates to create GitHub issues with appropriate labels:

- `good first issue` for Issues 1, 6, 8, 11, 12
- `help wanted` for all issues
- `stellar wave` if participating in a campaign
- Area labels: `cli`, `frontend`, `backend`, `scenarios`, `documentation`, `testing`
