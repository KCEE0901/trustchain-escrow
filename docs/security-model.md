# Trustchain Escrow Security Model Documentation

This document describes the security architecture, threat model, access control matrix, cryptographic guarantees, and smart contract invariants enforced across Trustchain Escrow.

---

## Table of Contents

1. [System Architecture & Boundaries](#system-architecture--boundaries)
2. [Threat Model](#threat-model)
3. [Access Control Matrix](#access-control-matrix)
4. [Smart Contract Invariants](#smart-contract-invariants)
5. [Cryptographic Security](#cryptographic-security)
6. [API & Backend Security](#api--backend-security)
7. [Audit & Vulnerability Reporting](#audit--vulnerability-reporting)
8. [Cross-References](#cross-references)

---

## System Architecture & Boundaries

Trustchain Escrow operates across three distinct security boundaries:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. Client & Wallet Boundary (User Premises)                                 │
│    - Key storage (Freighter, Albedo, hardware wallet)                       │
│    - Client-side transaction signing (Ed25519)                              │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Signed Transactions / JWT
┌──────────────────────────────────────▼──────────────────────────────────────┐
│ 2. Backend API & Off-Chain Infrastructure                                   │
│    - Express.js API Layer (MFA, JWT verification, rate limiting)            │
│    - Database & Cache (PostgreSQL + Redis)                                  │
│    - Indexer & Webhook Processor (BullMQ worker queues)                     │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ RPC Calls (Soroban Host)
┌──────────────────────────────────────▼──────────────────────────────────────┐
│ 3. Soroban Smart Contract Boundary (On-Chain)                               │
│    - Immutable state & funds escrow balance                                 │
│    - Cryptographic auth checks (require_auth)                               │
│    - Deterministic Wasm execution on Stellar validators                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Threat Model

| Threat | Impact | Mitigation Strategy |
| :--- | :--- | :--- |
| **Unauthorized Milestone Payout** | High | Soroban `client.require_auth()` ensures only the designated escrow client address can authorize milestone fund release. |
| **Arbiter Impersonation** | High | Dispute settlement requires `arbiter.require_auth()`. Only the exact address stored in `EscrowState.arbiter` is recognized. |
| **Reentrancy Attack** | High | Soroban's execution model prevents reentrant external contract callbacks during token transfers. State transitions occur prior to transfer invocation. |
| **Replay Attacks** | Medium | Stellar transactions include sequence numbers (`seq_num`) and footprint declarations validated by Stellar Consensus (SCP). |
| **Over-allocation / Arithmetic Overflow** | High | Checked arithmetic operations in Rust (`checked_add`, `checked_sub`). Total milestone allocations must strictly equal `total_amount`. |
| **API Webhook Forgery** | Medium | Webhooks are signed with an `HMAC-SHA256` signature header (`X-Trustchain-Signature`). |

---

## Access Control Matrix

The table below outlines permissions for each system role across core operations:

| Function / Operation | Client | Contractor | Arbiter | Admin / Owner | Unauthenticated |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `create_escrow` | **Caller** | Assigned | Optional | No | No |
| `submit_milestone` | No | **Caller** | No | No | No |
| `approve_milestone` | **Caller** | No | No | No | No |
| `raise_dispute` | **Allowed** | **Allowed** | No | No | No |
| `resolve_dispute` | No | No | **Caller** | Fallback | No |
| `claim_expired_refund` | **Caller** | No | No | Fallback | No |
| `view_escrow_details` | Allowed | Allowed | Allowed | Allowed | Public Read |

---

## Smart Contract Invariants

Soroban smart contracts (`contracts/escrow_contract/src/lib.rs`) enforce strict formal invariants that hold across all state transitions:

1. **Balance Integrity Invariant**:
   $$\text{Contract Token Balance} \ge \sum \text{Unreleased Escrow Funds}$$
   The contract can never be rendered insolvent.

2. **Milestone Allocation Invariant**:
   $$\sum_{i=0}^{N-1} \text{MilestoneAmount}_i = \text{TotalEscrowAmount}$$
   Escrow initialization fails if milestone totals do not equal the declared total amount.

3. **State Transition Hierarchy**:
   $$\text{Active} \longrightarrow \{\text{Completed}, \text{Disputed}, \text{Cancelled}, \text{Expired}\}$$
   $$\text{Disputed} \longrightarrow \text{Completed}$$
   Terminal states (`Completed`, `Cancelled`, `Expired`) are irreversible.

4. **Timelock Enforcement**:
   If `lock_time` is specified, `approve_milestone` calls fail with `EscrowError::TimelockActive` if `env.ledger().timestamp() < lock_time`.

---

## Cryptographic Security

- **Digital Signatures**: All Stellar transactions use Ed25519 signature schemes verified by the Soroban host environment (`Address::require_auth`).
- **Deliverable Manifest Integrity**: Deliverable files and dispute evidence are hashed using SHA-256 before storage on IPFS. The resulting 32-byte hash (`BytesN<32>`) is stored immutably on-chain.
- **Webhook Signatures**: Webhook payloads are signed using HMAC-SHA256:
  $$\text{Signature} = \text{HMAC-SHA256}(\text{Secret}, \text{Timestamp} \parallel "." \parallel \text{Payload})$$

---

## API & Backend Security

1. **Authentication & Authorization**:
   - Bearer JWT tokens with short expiry (15 minutes) and HTTP-only refresh tokens.
   - User identity bound to verified Stellar wallet addresses.

2. **Rate Limiting**:
   - Sliding-window Redis counters enforce rate limits:
     - Public endpoints: 100 requests / minute.
     - Auth / Escrow creation: 20 requests / minute.

3. **SQL Injection & Input Validation**:
   - Database operations use Prisma ORM parameterized queries.
   - Express request bodies are validated against OpenAPI schemas (`backend/openapi.yaml`).

---

## Audit & Vulnerability Reporting

- Smart contract security checklists are maintained at `docs/smart-contract-security-checklist.md`.
- Vulnerability disclosure and bug bounty policies are documented in `SECURITY.md` and `docs/BUG_BOUNTY.md`.

---

## Cross-References

- [Security Disclosure Policy](../SECURITY.md) — Responsible disclosure policy.
- [Smart Contract Security Checklist](smart-contract-security-checklist.md) — Pre-audit checklist.
- [API Authentication & Audit Logs](api-auth-audit.md) — API authorization and audit logging details.
- [Configuration Reference](configuration.md) — Security environment variable settings.
