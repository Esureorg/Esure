# Changelog

All notable changes to ESURE will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- CLI package (`esure-cli`) for terminal and CI usage with commands: `list`, `validate`, `run`
- JSON output format for CLI (`--output json`) for CI integration
- 7 new Testnet scenarios: insufficient-xlm-balance, payment-with-memo, multi-operation-transaction, trustline-limit-exceeded, trustline-already-exists, minimum-xlm-payment, basic-payment-with-checks
- Stellar error interpretation system with 30+ error codes including plain-English explanations, causes, and suggestions
- Comprehensive CI integration guide with GitHub Actions, GitLab CI, and CircleCI examples
- Error retryability detection based on Stellar error types

### Changed
- Scenario naming for accuracy: zero-amount-payment → minimum-xlm-payment, account-merge-simple → basic-payment-with-checks
- Documentation language: "production-ready" → "MVP" to accurately reflect Testnet-only status
- Error messages now include developer-friendly interpretations alongside technical codes

### Fixed
- Example workflow moved from .github/workflows to esure-docs/examples to prevent CI failures
- Test expectations updated to handle dynamic scenario count (≥10 scenarios)

## [0.1.0] - 2024-08-09

### Added
- Initial MVP release
- Testnet-only Stellar scenario runner with dashboard
- 3 bundled scenarios: xlm-payment, issued-asset-payment, missing-trustline
- Next.js frontend dashboard
- Fastify backend API with scenario validation
- Declarative JSON/YAML scenario schema (v1)
- Optional PostgreSQL persistence for scenario catalog
- OpenAPI 3.1 specification
- Comprehensive documentation (API, Architecture, Scenarios, Persistence)
- Monorepo CI with backend and frontend checks
- Security: rejects Mainnet config, secret seeds, arbitrary code

### Security
- Testnet-only enforcement
- Scenario validation rejects secrets, URLs, XDR
- Ephemeral generated keys (never persisted)
- Sanitized error messages

[Unreleased]: https://github.com/Esureorg/Esure/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Esureorg/Esure/releases/tag/v0.1.0
