# Escrow Creation and Release Flow Guide

This guide provides an end-to-end walkthrough of creating, managing, and releasing milestone-based escrows on Trustchain Escrow using both the Soroban smart contracts on the Stellar network and the REST API.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Escrow Creation Flow](#escrow-creation-flow)
   - [Smart Contract Execution](#smart-contract-execution)
   - [REST API Endpoint](#rest-api-endpoint)
4. [Milestone Submission Flow](#milestone-submission-flow)
   - [Deliverable Hashing & IPFS](#deliverable-hashing--ipfs)
   - [Submitting Work](#submitting-work)
5. [Milestone Review and Release Flow](#milestone-review-and-release-flow)
   - [Client Review](#client-review)
   - [Funds Release Mechanics](#funds-release-mechanics)
6. [Timelocks and Expiration](#timelocks-and-expiration)
7. [Sequence Diagram](#sequence-diagram)
8. [Cross-References](#cross-references)

---

## Overview

Trustchain Escrow locks funds into Soroban smart contracts on Stellar until contractual milestones are delivered and approved. Funds are released incrementally per milestone rather than all at once, giving both clients and contractors transparent, audit-verifiable checkpoints.

```
┌──────────────┐     Deposit Funds     ┌──────────────┐     Submit Work      ┌──────────────┐
│    Client    │ ────────────────────► │  Soroban /   │ ◄─────────────────── │  Contractor  │
│              │ ◄──────────────────── │  Trustchain  │ ───────────────────► │              │
└──────────────┘    Approve & Release  └──────────────┘     Deliverables      └──────────────┘
```

---

## Prerequisites

Before creating or managing an escrow:
- **Stellar Account**: Both client and contractor require funded Stellar addresses (Testnet or Mainnet).
- **Token Balance & Allowance**: The client must hold sufficient XLM or SAC (Stellar Asset Contract) tokens and approve a token allowance for the Soroban escrow contract.
- **REST API Auth**: API access requires a Bearer JWT obtained via `POST /api/v1/auth/login`.

---

## Escrow Creation Flow

### Smart Contract Execution

Escrows are initialized on-chain by calling `create_escrow` on the Soroban escrow contract (`contracts/escrow_contract/src/lib.rs`).

```rust
pub fn create_escrow(
    env: Env,
    client: Address,
    freelancer: Address,
    token: Address,
    total_amount: i128,
    brief_hash: BytesN<32>,
    arbiter: Option<Address>,
    deadline: Option<u64>,
    lock_time: Option<u64>,
) -> Result<u64, EscrowError>
```

#### Key Parameters:
- `client`: Stellar address depositing the funds. Must sign the transaction.
- `freelancer`: Stellar address receiving milestone releases.
- `token`: SAC asset address (e.g. native XLM or custom SEP-41 token).
- `total_amount`: Total escrow amount in stroops (1 XLM = 10,000,000 stroops).
- `brief_hash`: SHA-256 hash of the escrow contract agreement / statement of work.
- `arbiter`: Optional third-party address authorized for dispute resolution.

### REST API Endpoint

Alternatively, escrows can be created via the backend API:

```http
POST /api/v1/escrows
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "title": "Web App Development",
  "contractorAddress": "GBC...CONTRACTOR",
  "tokenAddress": "CDLZ...TOKEN",
  "totalAmount": "5000000000",
  "arbiterAddress": "GAA...ARBITER",
  "milestones": [
    {
      "title": "Design Mockups",
      "amount": "1500000000",
      "description": "Figma design system and UI mockups"
    },
    {
      "title": "Frontend Implementation",
      "amount": "3500000000",
      "description": "React Next.js frontend code delivery"
    }
  ]
}
```

---

## Milestone Submission Flow

### Deliverable Hashing & IPFS

Contractors submit deliverables accompanied by a cryptographic IPFS multihash or SHA-256 hash of the work. This ensures deliverable proof is immutably linked on-chain.

### Submitting Work

Contractors submit a milestone deliverable by invoking `submit_milestone` on-chain:

```rust
pub fn submit_milestone(
    env: Env,
    escrow_id: u64,
    milestone_index: u32,
    deliverable_hash: BytesN<32>,
) -> Result<(), EscrowError>
```

Or via REST API:

```http
POST /api/v1/escrows/42/milestones/0/submit
Authorization: Bearer <CONTRACTOR_JWT>
Content-Type: application/json

{
  "ipfsHash": "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
  "notes": "Completed initial design system and component hierarchy"
}
```

---

## Milestone Review and Release Flow

### Client Review

Upon milestone submission:
1. The client receives notification via webhooks or dashboard.
2. Client inspects the IPFS deliverable hash and work artifacts.
3. If approved, client triggers fund release.

### Funds Release Mechanics

The client signs a transaction executing `approve_milestone`:

```rust
pub fn approve_milestone(
    env: Env,
    escrow_id: u64,
    milestone_index: u32,
) -> Result<(), EscrowError>
```

Or via REST API:

```http
POST /api/v1/escrows/42/release
Authorization: Bearer <CLIENT_JWT>
Content-Type: application/json

{
  "milestoneIndex": 0
}
```

#### On-Chain Action:
- The contract transfers the milestone's assigned amount directly to `freelancer`.
- The milestone state changes to `Approved`.
- When all milestones are approved, the escrow state moves to `Completed` and emits a `ReputationEvent` incrementing both parties' completed escrow tally.

---

## Timelocks and Expiration

- **Lock Time**: If `lock_time` is configured, milestone approvals are prevented until the specified Unix timestamp has elapsed.
- **Deadline Expiration**: If `deadline` passes without milestone completion or dispute, the client can request an automated refund by invoking `claim_expired_refund`.

---

## Sequence Diagram

```
Contractor                  Client                   Soroban Escrow Contract           REST API / DB
    │                          │                                │                            │
    │                          │──── POST /api/v1/escrows ─────►│                            │
    │                          │                                │                            ├─ Stores draft
    │                          │─── create_escrow(args...) ────►│                            │
    │                          │◄── Returns Escrow ID ──────────│                            ├─ Status: Active
    │                          │                                │                            │
    │── submit_milestone(0) ──►│                                │                            │
    │                          │                                │                            ├─ Status: Submitted
    │                          │──── Review Deliverable ───────►│                            │
    │                          │─── approve_milestone(0) ──────►│                            │
    │                          │                                │── Transfer Milestone Amt ─►│ (Contractor Wallet)
    │                          │                                │── Emit MilestoneApproved ──►│
    │                          │                                │                            ├─ Status: Completed
```

---

## Cross-References

- [Smart Contract Guide](smart-contract-guide.md) — Technical details of the Soroban Rust contract.
- [Dispute Resolution Guide](dispute-resolution-guide.md) — How to handle disputes when milestone review fails.
- [Event Schema Documentation](event-schema.md) — On-chain events emitted during creation and release.
- [Configuration Reference](configuration.md) — System limits, timeouts, and network parameters.
