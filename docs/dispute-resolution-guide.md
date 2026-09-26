# End-to-End Dispute Resolution Process Guide

This document details the dispute resolution lifecycle in Trustchain Escrow. It covers how disputes are initiated, how evidence is anchored on-chain and IPFS, arbiter evaluation workflows, percentage-based fund settlements, and reputation impacts.

---

## Table of Contents

1. [Overview](#overview)
2. [Dispute Prerequisites & Eligibility](#dispute-prerequisites--eligibility)
3. [Initiating a Dispute](#initiating-a-dispute)
   - [Soroban Smart Contract Method](#soroban-smart-contract-method)
   - [REST API Endpoint](#rest-api-endpoint)
4. [Evidence Submission and Hashing](#evidence-submission-and-hashing)
   - [IPFS & SHA-256 Storage](#ipfs--sha-256-storage)
5. [Arbiter Workflow & Evaluation](#arbiter-workflow--evaluation)
   - [Arbiter Role](#arbiter-role)
   - [Dispute Notification](#dispute-notification)
6. [Ruling & Fund Distribution](#ruling--fund-distribution)
   - [Executing `resolve_dispute`](#executing-resolve_dispute)
   - [Split Calculation Examples](#split-calculation-examples)
7. [Reputation Impact](#reputation-impact)
8. [Sequence Diagram](#sequence-diagram)
9. [Cross-References](#cross-references)

---

## Overview

When a disagreement arises over milestone deliverables, either the Client or the Contractor can flag the escrow as **Disputed**. Placing an escrow in the `Disputed` state freezes all unreleased funds and transfers settlement authority exclusively to the designated **Arbiter** (or contract admin if no arbiter was specified).

---

## Dispute Prerequisites & Eligibility

A dispute can be raised if and only if:
1. The escrow status is currently `Active`.
2. The caller is either the `client` or the `freelancer` associated with the escrow.
3. Unreleased funds remain locked in the escrow contract balance.

Once raised, standard milestone approvals (`approve_milestone`) are blocked until the arbiter issues a ruling.

---

## Initiating a Dispute

### Soroban Smart Contract Method

A participant initiates a dispute by invoking `raise_dispute` on the Soroban escrow contract (`contracts/escrow_contract/src/lib.rs`):

```rust
pub fn raise_dispute(
    env: Env,
    caller: Address,
    escrow_id: u64,
    evidence_hash: BytesN<32>,
) -> Result<(), EscrowError>
```

#### Contract State Changes:
- Validates `caller` signature matches `client` or `freelancer`.
- Updates `EscrowState.status` from `Active` to `Disputed`.
- Stores `evidence_hash` on-chain.
- Emits a `DisputeRaised` contract event.

### REST API Endpoint

Disputes can also be raised via the backend API:

```http
POST /api/v1/escrows/42/dispute
Authorization: Bearer <USER_JWT>
Content-Type: application/json

{
  "reason": "Deliverable fails performance criteria outlined in brief",
  "evidenceFiles": [
    {
      "name": "benchmark_results.json",
      "ipfsHash": "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"
    }
  ]
}
```

---

## Evidence Submission and Hashing

### IPFS & SHA-256 Storage

To ensure evidence cannot be tampered with after a dispute is initiated:
1. Evidence files (chat logs, test reports, deliverables) are pinned to IPFS.
2. The SHA-256 digest of the combined evidence manifest is generated:
   $$\text{EvidenceHash} = \text{SHA-256}(\text{IPFS\_CID}_1 \parallel \text{IPFS\_CID}_2 \parallel \dots)$$
3. The 32-byte hash is permanently anchored in the Soroban contract state and indexed by Elasticsearch for arbiter review.

---

## Arbiter Workflow & Evaluation

### Arbiter Role

The `arbiter` is specified during `create_escrow`. The arbiter serves as an independent, neutral judge:
- **Authorized Actions**: The arbiter (or contract admin fallback) is the only address authorized to invoke `resolve_dispute`.
- **Review Period**: Arbiters review the statement of work, milestone deliverables, and submitted evidence hashes.

### Dispute Notification

When a dispute is raised, the backend dispatches signed webhooks (`escrow.disputed`) to subscribed arbiters and sends notifications to the web dashboard.

---

## Ruling & Fund Distribution

### Executing `resolve_dispute`

The arbiter resolves the dispute by issuing a percentage-based split ruling between the client and contractor:

```rust
pub fn resolve_dispute(
    env: Env,
    arbiter: Address,
    escrow_id: u64,
    client_share_bps: u32,     // Basis points (0 to 10,000)
    contractor_share_bps: u32, // Basis points (0 to 10,000)
) -> Result<(), EscrowError>
```

> Basis points constraint: `client_share_bps + contractor_share_bps == 10_000` (representing 100%).

Or via REST API:

```http
POST /api/v1/escrows/42/resolve
Authorization: Bearer <ARBITER_JWT>
Content-Type: application/json

{
  "clientShareBps": 3000,
  "contractorShareBps": 7000,
  "rulingRationale": "Contractor delivered 70% of functional requirements before conflict."
}
```

### Split Calculation Examples

For an unreleased balance of 1,000 XLM ($10,000,000,000\text{ stroops}$):

| Ruling Scenario | `clientShareBps` | `contractorShareBps` | Client Refund | Contractor Payout |
| :--- | :--- | :--- | :--- | :--- |
| **Full Contractor Win** | 0 (0%) | 10,000 (100%) | 0 XLM | 1,000 XLM |
| **Full Client Refund** | 10,000 (100%) | 0 (0%) | 1,000 XLM | 0 XLM |
| **Partial Split (70/30)** | 3,000 (30%) | 7,000 (70%) | 300 XLM | 700 XLM |

---

## Reputation Impact

Once `resolve_dispute` executes:
1. Funds are transferred instantly per the specified basis point breakdown.
2. The escrow state transitions to `Completed`.
3. A `ReputationEvent` is recorded on-chain:
   - If `contractor_share_bps >= 5000`, contractor gets a positive outcome event.
   - If `client_share_bps > 5000`, client gets a positive dispute resolution event.
   - Reputation indexes update automatically via background indexer services.

---

## Sequence Diagram

```
Participant (Client/Contractor)          Soroban Escrow Contract            Arbiter              Backend Indexer
       │                                            │                          │                        │
       │─── raise_dispute(evidence_hash) ──────────►│                          │                        │
       │                                            │── Update Status: Disputed│                        │
       │                                            │── Emit DisputeRaised ────┼───────────────────────►│
       │                                            │                          │                        ├─ Notify Arbiter
       │                                            │                          │◄── Review Evidence ────┤
       │                                            │◄─ resolve_dispute(bps) ──│                        │
       │                                            │                          │                        │
       │◄──────── Transfer Client Share ────────────│                          │                        │
       │───────── Transfer Contractor Share ───────►│                          │                        │
       │                                            │── Emit DisputeResolved ──┼───────────────────────►│
       │                                            │                          │                        ├─ Update Reputation DB
```

---

## Cross-References

- [Arbiter Role Guide](arbiter-guide.md) — Detailed guide on arbiter selection and permissions.
- [Escrow Creation and Release Flow](escrow-creation-release-guide.md) — Standard non-disputed escrow flow.
- [Reputation Scoring Documentation](reputation-scoring.md) — Mathematical formula for reputation score adjustments.
- [Slashing Mechanism](slashing-mechanism.md) — Malicious dispute penalties and stake slashing rules.
