# Testnet Reset Recovery Runbook

When the Stellar Testnet undergoes a reset or network downtime, historical transaction links and generated accounts may become unavailable. This runbook explains how to recognize network-related failures and safely recover by rerunning scenarios with fresh accounts.

## Symptoms of different failure types

### Network reset
A network reset clears all Testnet ledger state, account balances, and transaction history. You may observe:
- Friendbot funding fails with "no such account" or "account not found"
- Previously funded accounts report zero balances
- Transaction lookups return "not found" on Horizon
- New account generation works, but old accounts cannot be reused
- Error logs reference account or transaction state that no longer exists

Recovery action: [Rerun scenarios with fresh accounts](#rerunning-scenarios-with-fresh-accounts)

### Backend restart without network reset
The Esure backend or Horizon service may restart independently. You may observe:
- Transient connection timeouts or "service unavailable" errors
- Existing accounts and transactions remain available
- Retrying the same run with the same account succeeds
- Network state is consistent within a few seconds after restart

Recovery action: Wait briefly and [retry the run](#retrying-failed-runs); no fresh accounts needed.

### Report retention expiration
Esure reports are retained for a configured duration (default: 1 hour). You may observe:
- Run reports return `409 CONFLICT` or "not complete" on download
- Recent transaction lookups on Horizon succeed (the network did not reset)
- The run ID is correct but the report is no longer available locally
- The transaction hash still resolves on Horizon

Recovery action: The run itself is finished; no recovery is needed. Save reports immediately after runs complete, or configure a longer `RUN_RETENTION_MS` in the backend if you need longer access.

## Official network status

Testnet network resets are announced on the [Stellar Community Forum](https://stellar.community/) and the [Stellar Status page](https://stellar.status.io/). Before declaring a network reset:

1. Check the [Testnet Horizon health endpoint](https://horizon-testnet.stellar.org/health)
2. Visit the Stellar Community Forum and search for recent reset announcements
3. Verify your own Friendbot requests against a fresh generated account

Do not hardcode reset schedules or monitor dates in your code. Always consult the official sources above.

## Rerunning scenarios with fresh accounts

When you confirm a network reset has occurred, reruns are safe and expected:

1. **Retrieve your scenario definition**: If you saved the scenario YAML/JSON file, reuse the exact same file. If you lost the definition, recreate it from your requirements.
2. **Generate fresh accounts**: Esure scenarios always use `generate: true` for accounts, so each run automatically creates fresh accounts. No manual account creation is needed.
3. **Resubmit the scenario**: POST to `/api/v1/runs` or use the CLI with your scenario definition.
4. **Verify transaction links**: After the run completes, check that new transaction links resolve on Horizon. If they do not, the network reset may still be in progress; wait and retry.
5. **Save the report immediately**: Use `GET /api/v1/runs/{runId}/report` to download the sanitized report before the retention window expires.

Example using the CLI:

```bash
cd esure-cli
npm ci
npm run build
node dist/cli.js run ./my-scenario.yaml --output json > report-after-reset.json
```

## Preserving offline reports

Esure reports are JSON documents and can be safely stored offline:

1. Download the report from `GET /api/v1/runs/{runId}/report` immediately after a run completes.
2. Save it as a JSON file in your version-control system, artifact store, or documentation.
3. Offline reports do not expire and can be shared, analyzed, or reaudited later.
4. Transaction links in old reports may stop resolving on Horizon after a network reset, but the historical data in the report itself remains valid.

Example saving a report:

```bash
curl https://esure.onrender.com/api/v1/runs/abc123/report > historical-report.json
```

## Troubleshooting

### "Friendbot unavailable" errors
Friendbot (the Testnet faucet) may be temporarily down independently of a network reset. Verify:
- Recent transaction lookups on Horizon work (network is online)
- New accounts generate successfully (your code runs)
- Fresh Friendbot requests on simple accounts succeed (faucet is available)

If Friendbot is down, wait 5-10 minutes and retry with a fresh run. If the issue persists, check the [Stellar Community Forum](https://stellar.community/) for status updates.

### "Transaction not found" on Horizon
After a run succeeds, transaction links may fail to resolve if:
- The network reset after the transaction was confirmed (expected, see [Network reset](#network-reset))
- Report retention expired and the run record was deleted from Esure (your local copy, if saved, is still accurate)
- A rare network synchronization issue occurred (wait a minute and retry the link)

If a recent transaction link does not resolve but Horizon is online, consult the [Stellar Status page](https://stellar.status.io/) and wait for network synchronization.

### Multiple failed runs
If several consecutive runs fail with consistent network errors:
1. Verify the backend is online: `curl https://esure.onrender.com/health`
2. Check the [Stellar Status page](https://stellar.status.io/) for ongoing incidents
3. Wait 10-15 minutes, as Testnet may be recovering from an outage
4. Retry a simple bundled scenario like `xlm-payment` to isolate your scenario definition from network issues

## See also

- [Scenario Schema](./SCENARIOS.md) — Scenario definition format and validation
- [Backend API](./API.md) — Run creation, status polling, and report endpoints
- [System Architecture](./ARCHITECTURE.md) — How Esure runs scenarios and persists reports
