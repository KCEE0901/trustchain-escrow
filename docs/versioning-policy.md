# Changelog and Versioning Policy

This document defines the changelog format and versioning policy used by Trustchain Escrow.

Related reading:

- [CHANGELOG.md](../CHANGELOG.md) — the project's changelog
- [Contributing Guide](../CONTRIBUTING.md) — commit conventions and PR process

---

## Versioning Policy

Trustchain Escrow follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (SemVer 2.0.0). Versions are formatted as `MAJOR.MINOR.PATCH`.

| Component | When to Bump | Example |
| --------- | ------------ | ------- |
| **MAJOR** | Incompatible changes to the smart contract storage schema, API contract, or on-chain state format that require a migration | `2.0.0` |
| **MINOR** | New features that are backward-compatible, including new contract functions, new API endpoints, and new configuration options | `2.1.0` |
| **PATCH** | Backward-compatible bug fixes, security patches, and internal refactors | `2.1.1` |

### Pre-release Versions

Pre-release versions use the format `MAJOR.MINOR.PATCH-alpha.N` or `MAJOR.MINOR.PATCH-beta.N`:

- `2.1.0-alpha.1` — first alpha of the 2.1.0 release
- `2.1.0-beta.1` — first beta of the 2.1.0 release
- `2.1.0-rc.1` — first release candidate

Pre-release versions have lower precedence than the associated stable version. For example, `2.1.0-alpha.1 < 2.1.0`.

### Version Sources of Truth

| File | Purpose |
| ---- | ------- |
| `package.json` (`version`) | Frontend and workspace version |
| `backend/package.json` (`version`) | Backend API version |
| `CHANGELOG.md` | Human-readable changelog |
| Smart contract `Cargo.toml` (`version`) | On-chain contract version |

---

## Changelog Format

The changelog follows the format of [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

### Structure

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- New feature description

### Changed
- Changed behavior description

### Deprecated
- Deprecated feature description

### Removed
- Removed feature description

### Fixed
- Bug fix description

## [MAJOR.MINOR.PATCH] - YYYY-MM-DD

### Added
### Changed
### Deprecated
### Removed
### Fixed
```

### Sections

| Section | Description |
| ------- | ----------- |
| **Added** | New features |
| **Changed** | Changes in existing functionality |
| **Deprecated** | Features that will be removed in a future release |
| **Removed** | Features removed in this release |
| **Fixed** | Bug fixes |

### Linking Versions

Each version section links to the GitHub compare URL between that version and the previous one:

```markdown
[Unreleased]: https://github.com/KCEE0901/trustchain-escrow/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/KCEE0901/trustchain-escrow/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/KCEE0901/trustchain-escrow/releases/tag/v1.0.0
```

---

## Release Process

1. **Prepare the release** — Update `CHANGELOG.md` with all changes since the last release under the `Unreleased` section, then move them to a new version section.
2. **Bump the version** — Update `version` in `package.json`, `backend/package.json`, and the smart contract `Cargo.toml`.
3. **Create a git tag** — `git tag vMAJOR.MINOR.PATCH`
4. **Create a GitHub Release** — Attach the tag, link the compare URL, and paste the changelog section.
5. **Deploy** — Follow the [Production Deployment Guide](../production-deployment-guide.md) for mainnet deployment.

---

## Breaking Changes

A breaking change is any change that requires existing users or integrators to modify their code or configuration. Examples include:

- Changing the smart contract storage schema (requires a storage migration)
- Removing or renaming API endpoints
- Changing the request or response format of an API endpoint
- Changing the on-chain function signatures or parameter types
- Changing the minimum required Node.js, Rust, or Soroban CLI version

Breaking changes must be clearly marked in the changelog with a `> **Breaking change:**` callout and must be accompanied by a migration guide if the change affects on-chain state.