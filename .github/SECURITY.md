# Esure security policy

## Supported versions

Esure is pre-release software. Only the latest commit on `main` is currently
supported with security fixes.

## Reporting a vulnerability

Do not open a public GitHub issue for a suspected vulnerability.

Use GitHub's **Report a vulnerability** option in the affected repository's
Security tab. If private vulnerability reporting is not enabled, contact an
organization owner privately and ask for a secure reporting channel without
including exploit details in the first message.

Include:

- The affected repository and revision
- Reproduction steps or a minimal proof of concept
- The expected and observed behavior
- Potential impact
- Any suggested mitigation

Maintainers should acknowledge a complete report within five business days and
provide status updates while it is investigated. Timelines depend on severity
and whether a coordinated disclosure is required.

## High-risk areas

- Secret-key exposure in logs, errors, reports, tests, or telemetry
- Ability to use Mainnet or attacker-controlled network endpoints
- Arbitrary command, URL, or transaction-envelope execution
- Server-side request forgery through the frontend proxy
- Scenario validation bypasses or resource exhaustion
- Dependency or CI workflow compromise

Never include a real private key or real funds in a report or reproduction.

