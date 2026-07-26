# Smart Contract ABI & Entry Point Reference

This document provides a comprehensive technical specification of the Soroban smart contract application binary interfaces (ABI), function signatures, argument types, authorization checks, storage layout, event schemas, and error codes across the **Trustchain Escrow** protocol.

---

## Table of Contents

1. [Overview & Crate Architecture](#overview--crate-architecture)
2. [Data Types & Enums](#data-types--enums)
3. [Storage Layout & Data Keys](#storage-layout--data-keys)
4. [Escrow Contract (`escrow_contract`) ABI](#escrow-contract-escrow_contract-abi)
   - [Lifecycle Entry Points](#lifecycle-entry-points)
   - [Milestone Operations](#milestone-operations)
   - [Dispute Resolution](#dispute-resolution)
   - [Batch Operations](#batch-operations)
   - [View & Read-Only Entry Points](#view--read-only-entry-points)
5. [Governance Contract (`governance`) ABI](#governance-contract-governance-abi)
6. [Insurance Pool Contract (`insurance_contract`) ABI](#insurance-pool-contract-insurance_contract-abi)
7. [Escrow Extensions Contract (`escrow_extensions`) ABI](#escrow-extensions-contract-escrow_extensions-abi)
8. [Emitted Events Reference](#emitted-events-reference)
9. [Error Codes Table (`EscrowError`)](#error-codes-table-escrowerror)
10. [Cross-References](#cross-references)

---

## Overview & Crate Architecture

The Trustchain Escrow smart contract architecture consists of modular Soroban smart contract crates built on the Stellar blockchain:

```
contracts/
├── escrow_contract/       # Primary escrow lifecycle, milestones, disputes & reputation
├── governance/            # Arbiter registration, DAO governance & escalation rulings
├── insurance_contract/    # Protocol insurance pool & collateral protection
├── escrow_extensions/     # Recurring payment schedules & multisig escrow extensions
└── shared/                # Shared authorization helpers & TTL bump utilities
```

---

## Data Types & Enums

### Key Custom Types

#### `EscrowStatus`
```rust
#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EscrowStatus {
    Created = 0,
    Active = 1,
    Completed = 2,
    Disputed = 3,
    Cancelled = 4,
}
```

#### `MilestoneStatus`
Milestone status is stored as a lightweight `u32` bitflag to optimize gas:
```rust
pub const MS_PENDING: u32 = 0;
pub const MS_SUBMITTED: u32 = 1;
pub const MS_APPROVED: u32 = 2;
pub const MS_REJECTED: u32 = 3;
pub const MS_RELEASED: u32 = 4;
pub const MS_DISPUTED: u32 = 5;
```

#### `Milestone`
```rust
#[contracttype]
#[derive(Clone, Debug)]
pub struct Milestone {
    pub id: u32,
    pub description_hash: BytesN<32>,
    pub amount: i128,
    pub status: u32,
    pub submitted_at: Option<u64>,
}
```

---

## Storage Layout & Data Keys

The protocol utilizes granular persistent storage entries to eliminate gas penalties associated with serializing large structs.

```rust
#[contracttype]
#[derive(Clone)]
pub enum PackedDataKey {
    EscrowMeta(u64),        // Granular header for escrow ID
    Milestone(u64, u32),    // Granular entry for milestone (escrow_id, milestone_id)
    RecurringConfig(u64),   // Config entry for recurring payment schedule
}
```

---

## Escrow Contract (`escrow_contract`) ABI

### Lifecycle Entry Points

#### `initialize`
Initializes contract configuration, admin key, and protocol fee recipient.

- **Signature**:
  ```rust
  fn initialize(env: Env, admin: Address, fee_recipient: Address, fee_bps: u32) -> Result<(), EscrowError>
  ```
- **Authorization**: `admin.require_auth()`
- **Type**: Mutating

#### `create_escrow`
Creates a new milestone escrow agreement and initializes metadata storage.

- **Signature**:
  ```rust
  fn create_escrow(
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
- **Authorization**: `client.require_auth()`
- **Limits**: `total_amount` must satisfy `MIN_ESCROW_AMOUNT <= total_amount <= MAX_ESCROW_AMOUNT`.
- **Returns**: `u64` (unique `escrow_id`).

#### `deposit_funds`
Transfers specified token total amount from client to escrow contract instance.

- **Signature**:
  ```rust
  fn deposit_funds(env: Env, client: Address, escrow_id: u64) -> Result<(), EscrowError>
  ```
- **Authorization**: `client.require_auth()`

---

### Milestone Operations

#### `add_milestone`
Adds a single milestone definition to an active escrow before locking.

- **Signature**:
  ```rust
  fn add_milestone(
      env: Env,
      caller: Address,
      escrow_id: u64,
      title: String,
      description_hash: BytesN<32>,
      amount: i128,
  ) -> Result<u32, EscrowError>
  ```
- **Authorization**: `caller.require_auth()` (Client only)
- **Returns**: `u32` (assigned `milestone_id`).

#### `submit_milestone`
Marks a milestone as submitted for review by freelancer.

- **Signature**:
  ```rust
  fn submit_milestone(env: Env, caller: Address, escrow_id: u64, milestone_id: u32) -> Result<(), EscrowError>
  ```
- **Authorization**: `caller.require_auth()` (Freelancer only)

#### `approve_milestone`
Approves a submitted milestone and marks it ready for fund release.

- **Signature**:
  ```rust
  fn approve_milestone(env: Env, caller: Address, escrow_id: u64, milestone_id: u32) -> Result<(), EscrowError>
  ```
- **Authorization**: `caller.require_auth()` (Client only)

#### `release_funds`
Transfers the approved milestone fund amount from escrow contract to freelancer.

- **Signature**:
  ```rust
  fn release_funds(env: Env, caller: Address, escrow_id: u64, milestone_id: u32) -> Result<(), EscrowError>
  ```
- **Authorization**: `caller.require_auth()` (Client or Freelancer)

---

### Dispute Resolution

#### `dispute_escrow`
Raises an active dispute on a milestone, locking funds and inviting designated arbiter.

- **Signature**:
  ```rust
  fn dispute_escrow(
      env: Env,
      caller: Address,
      escrow_id: u64,
      milestone_id: u32,
      reason_hash: BytesN<32>,
  ) -> Result<(), EscrowError>
  ```
- **Authorization**: `caller.require_auth()` (Client or Freelancer)

#### `resolve_dispute`
Executes arbiter ruling, splitting milestone funds according to ruling basis points.

- **Signature**:
  ```rust
  fn resolve_dispute(
      env: Env,
      arbiter: Address,
      escrow_id: u64,
      milestone_id: u32,
      client_share_bps: u32,
      freelancer_share_bps: u32,
  ) -> Result<(), EscrowError>
  ```
- **Authorization**: `arbiter.require_auth()`
- **Constraint**: `client_share_bps + freelancer_share_bps == 10000` (100.00%).

---

### Batch Operations

#### `batch_add_milestones`
Adds up to `MAX_MILESTONES` (20) in a single atomic transaction call.

- **Signature**:
  ```rust
  fn batch_add_milestones(
      env: Env,
      caller: Address,
      escrow_id: u64,
      amounts: Vec<i128>,
      description_hashes: Vec<BytesN<32>>,
  ) -> Result<Vec<u32>, EscrowError>
  ```

#### `batch_approve_milestones`
Approves multiple milestones in a single transaction.

- **Signature**:
  ```rust
  fn batch_approve_milestones(
      env: Env,
      caller: Address,
      escrow_id: u64,
      milestone_ids: Vec<u32>,
  ) -> Result<(), EscrowError>
  ```

---

### View & Read-Only Entry Points

#### `get_escrow`
Fetches complete escrow view object.

- **Signature**: `fn get_escrow(env: Env, escrow_id: u64) -> Result<EscrowState, EscrowError>`
- **Authorization**: None (Public View)

#### `get_milestone`
Reads single milestone record by ID.

- **Signature**: `fn get_milestone(env: Env, escrow_id: u64, milestone_id: u32) -> Result<Milestone, EscrowError>`
- **Authorization**: None (Public View)

#### `get_reputation`
Gets calculated reputation score and history for a given address.

- **Signature**: `fn get_reputation(env: Env, address: Address) -> Result<ReputationRecord, EscrowError>`
- **Authorization**: None (Public View)

---

## Governance Contract (`governance`) ABI

- `register_arbiter(env: Env, address: Address, stake_amount: i128) -> Result<(), GovernanceError>`
- `escalate_dispute(env: Env, caller: Address, escrow_id: u64) -> Result<u64, GovernanceError>`
- `vote_proposal(env: Env, voter: Address, proposal_id: u64, approve: bool) -> Result<(), GovernanceError>`

---

## Insurance Pool Contract (`insurance_contract`) ABI

- `deposit_collateral(env: Env, provider: Address, amount: i128) -> Result<(), InsuranceError>`
- `claim_coverage(env: Env, claimant: Address, escrow_id: u64, loss_amount: i128) -> Result<(), InsuranceError>`

---

## Escrow Extensions Contract (`escrow_extensions`) ABI

- `create_recurring_schedule(env: Env, client: Address, freelancer: Address, interval: RecurringInterval, amount: i128) -> Result<u64, ExtensionError>`
- `approve_multisig_release(env: Env, signer: Address, escrow_id: u64, milestone_id: u32) -> Result<(), ExtensionError>`

---

## Emitted Events Reference

| Event Name | Topic 1 | Topic 2 | Data Payload |
| :--- | :--- | :--- | :--- |
| `EscrowCreated` | `symbol_short!("created")` | `escrow_id: u64` | `(client: Address, freelancer: Address, total_amount: i128)` |
| `MilestoneSubmitted` | `symbol_short!("submitted")` | `escrow_id: u64` | `(milestone_id: u32, submitted_at: u64)` |
| `MilestoneApproved` | `symbol_short!("approved")` | `escrow_id: u64` | `(milestone_id: u32, client: Address)` |
| `FundsReleased` | `symbol_short!("released")` | `escrow_id: u64` | `(milestone_id: u32, recipient: Address, amount: i128)` |
| `DisputeRaised` | `symbol_short!("disputed")` | `escrow_id: u64` | `(milestone_id: u32, initiator: Address, reason_hash: BytesN<32>)` |
| `DisputeResolved` | `symbol_short!("resolved")` | `escrow_id: u64` | `(arbiter: Address, client_share: i128, freelancer_share: i128)` |

---

## Error Codes Table (`EscrowError`)

| Integer Code | Enum Identifier | Cause & Resolution |
| :--- | :--- | :--- |
| `1` | `NotInitialized` | Contract instance has not been initialized. |
| `2` | `AlreadyInitialized` | `initialize` was called on an initialized contract instance. |
| `3` | `Unauthorized` | Caller fails `require_auth()` or lacks required role. |
| `4` | `EscrowNotFound` | Specified `escrow_id` does not exist in persistent storage. |
| `5` | `MilestoneNotFound` | Specified `milestone_id` does not exist for the given escrow. |
| `6` | `InvalidStatus` | Transition invalid for current `EscrowStatus`. |
| `7` | `InvalidMilestoneStatus` | Milestone state transition invalid for operation. |
| `8` | `AmountMismatch` | Milestone amounts sum exceeds total escrow allocated amount. |
| `9` | `MaxMilestonesExceeded` | Attempted to add more than `MAX_MILESTONES` (20). |
| `10` | `InsufficientReputation` | Arbiter candidate score is below `MIN_ARBITER_REPUTATION_SCORE` (100). |
| `11` | `InvalidBasisPoints` | Arbiter ruling share sum != 10000 (100%). |
| `12` | `TimelockNotExpired` | Fund release attempted before designated timelock timestamp. |

---

## Cross-References

- [Developer Guide](smart-contract-guide.md) — Contract development and testing workflow.
- [REST API Reference](api-reference.md) — Backend REST endpoints wrapping smart contract calls.
- [Architecture Overview](architecture-overview.md) — System component interaction and data flow.
