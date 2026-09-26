# Glossary of Escrow and Stellar-Specific Terms

This glossary defines key terms used throughout the Trustchain Escrow platform,
its documentation, and its smart contracts. Terms are organized thematically to
help developers, operators, and end users navigate unfamiliar concepts quickly.

---

## Table of Contents

1. [Escrow Concepts](#escrow-concepts)
2. [Milestone and Lifecycle Terms](#milestone-and-lifecycle-terms)
3. [Dispute and Reputation Terms](#dispute-and-reputation-terms)
4. [Stellar Network Terms](#stellar-network-terms)
5. [Soroban Smart Contract Terms](#soroban-smart-contract-terms)
6. [API and Backend Terms](#api-and-backend-terms)
7. [Cross-References](#cross-references)

---

## Escrow Concepts

**Escrow**
A contractual arrangement in which a neutral third party (in Trustchain's case, a
Soroban smart contract) holds funds on behalf of two transacting parties until
pre-agreed conditions are met. Unlike a traditional bank-held escrow, Trustchain
escrows are held entirely on-chain with no human intermediary.

**Client (Funder)**
The party that deposits funds into an escrow. The client approves milestone
completion and, in the event of a dispute, is one of the two principals who may
submit evidence to an arbiter. Also referred to as the *buyer* or *project owner*
in some contexts.

**Contractor (Freelancer)**
The party that receives milestone-gated payments from an escrow in exchange for
delivering agreed work. The contractor submits milestones with on-chain deliverable
hashes and builds an immutable reputation from the outcome. Also referred to as the
*seller* or *service provider*.

**Arbiter**
A trusted third party (human or multi-sig) with on-chain authority to resolve
disputes. The arbiter calls `submit_ruling` to split escrowed funds between client
and contractor as a percentage. Arbiter identity is recorded at escrow creation
and cannot be changed after funding.

**Timelock**
An optional Unix timestamp set at escrow creation after which, if no milestone has
been approved, the contract automatically transitions to `Expired` and the client
may reclaim deposited funds. Timelocks are enforced by Soroban ledger time, not a
backend cron job.

**Funding Token**
The Stellar asset (XLM or a SAC-wrapped token) locked inside an escrow contract.
The token address is fixed at creation; both parties see the same on-chain token
balance at all times.

**Allowance**
Before calling `create_escrow`, the client must authorize the escrow contract to
transfer the funding token on their behalf using the Stellar token's `approve`
function. This is equivalent to an ERC-20 approval.

---

## Milestone and Lifecycle Terms

**Milestone**
A discrete, value-carrying unit of work within an escrow. Each milestone has:
- a description hash (SHA-256 of the deliverable specification)
- an amount in the funding token
- a completion status (`Pending`, `Submitted`, `Approved`, `Disputed`)

Milestones are defined at escrow creation and cannot be added or removed after the
contract is deployed.

**Deliverable Hash**
A SHA-256 or IPFS CID that the contractor records on-chain when submitting a
milestone. The hash anchors the off-chain deliverable (code, design file, report,
etc.) to an immutable on-chain record, giving the client proof that the submitted
work existed at a specific ledger sequence.

**IPFS CID (Content Identifier)**
A self-describing, content-addressed identifier produced by hashing a file with
SHA-256 (CIDv1). Trustchain stores IPFS CIDs on-chain as deliverable references so
that evidence cannot be silently replaced or deleted by either party.

**Escrow States**

| State       | Description                                                       |
|-------------|-------------------------------------------------------------------|
| `Active`    | Escrow is funded; milestones are in progress.                     |
| `Disputed`  | One party raised a dispute; awaiting arbiter ruling.              |
| `Completed` | All milestones approved or arbiter ruling finalised.              |
| `Cancelled` | Both parties consented to cancel; funds returned to client.       |
| `Expired`   | Timelock elapsed without completion; client may auto-refund.      |

**Incremental Release**
The pattern of releasing funds one milestone at a time rather than all at once.
Only the approved milestone's allocation is transferred to the contractor; the
remainder stays locked in the contract until subsequent approvals.

---

## Dispute and Reputation Terms

**Dispute**
A formal on-chain claim raised by either the client or contractor when they believe
the other party has breached the escrow terms. Raising a dispute transitions the
escrow to `Disputed` and freezes all further milestone submissions until an arbiter
resolves it.

**Evidence Hash**
An array of IPFS CIDs or SHA-256 hashes submitted alongside a dispute claim. These
hashes anchor screenshots, communications, deliverables, or any other evidence to
the on-chain dispute record.

**Ruling**
The arbiter's binding on-chain decision that allocates a percentage of the locked
funds to the client and the remainder to the contractor. Percentages must sum to
100. The ruling is irreversible once submitted.

**ReputationEvent**
An on-chain event emitted when an escrow reaches a terminal state (`Completed` or
`Cancelled`). Each event records the outcome (win, loss, neutral) for both parties'
Stellar addresses. Reputation scores are derived by aggregating all `ReputationEvent`
records for an address across every escrow they have participated in.

**Reputation Score**
A derived metric computed from all `ReputationEvent` records for a Stellar address.
It is public, immutable, portable across dApps, and queryable directly from the
Soroban contract. See [docs/reputation-scoring.md](reputation-scoring.md) for the
scoring algorithm.

---

## Stellar Network Terms

**Stellar**
A public, open-source blockchain network optimised for fast, low-cost asset
transfers and programmable financial logic via the Soroban smart contract runtime.
Stellar uses the Federated Byzantine Agreement (FBA) consensus protocol.

**XLM (Lumen)**
The native asset of the Stellar network, used to pay transaction fees and maintain
account reserves. XLM can be used directly as the funding token in a Trustchain
escrow.

**Stellar Address**
A base32-encoded public key (e.g. `GBBD47...`) that identifies an account on the
Stellar network. Both client and contractor identities in an escrow are stored as
Stellar addresses.

**Stellar Asset Contract (SAC)**
A Soroban-compatible wrapper that exposes any Stellar Classic asset (e.g. USDC,
BTC-pegged tokens) through the standard SEP-41 token interface, allowing it to be
used as a funding token in escrow contracts.

**Freighter**
The browser extension wallet most commonly used to sign Stellar transactions in
Trustchain's web dashboard. Freighter holds the user's private key and approves
on-chain operations without exposing the key to the application.

**Horizon**
Stellar's public REST API for reading blockchain state — transactions, operations,
account balances, and ledger entries. Trustchain's backend queries Horizon for
transaction confirmation and event history.

**Soroban RPC**
A JSON-RPC endpoint that accepts and simulates Soroban smart contract invocations
before they are submitted to the network. Trustchain uses Soroban RPC to build,
simulate, and broadcast contract transactions.

**Ledger Sequence**
An incrementing integer that identifies each closed ledger (block) on the Stellar
network. Timelocks and event timestamps are expressed in ledger sequences or Unix
timestamps derived from them.

**Testnet**
Stellar's public test network, which mirrors mainnet functionality but uses
worthless test XLM obtainable from the Friendbot faucet. All Trustchain development
and staging deployments target Testnet.

**Mainnet**
The live Stellar production network where real assets are transacted. Trustchain
mainnet deployments are pending a full smart contract security audit.

---

## Soroban Smart Contract Terms

**Soroban**
Stellar's WebAssembly (Wasm) smart contract platform. Contracts are written in Rust,
compiled to Wasm, and deployed on-chain. Soroban provides deterministic execution,
formal storage metering, and a type-safe host environment.

**Contract ID**
A unique identifier for a deployed Soroban contract. Trustchain contract IDs are
listed in the README under [Smart Contract Addresses](../README.md#smart-contract-addresses).

**Wasm**
WebAssembly — the binary instruction format into which Soroban Rust contracts are
compiled. The Wasm blob is stored on-chain and executed by the Soroban host.

**Env (`soroban_sdk::Env`)**
The Soroban host environment object passed to every contract function. `Env`
provides access to on-chain storage, cryptographic utilities, cross-contract calls,
ledger metadata, and event emission.

**Storage (`Env::storage()`)**
Soroban's key-value persistence layer. Trustchain uses `Persistent` storage for
escrow state (survives ledger expiry cycles) and `Temporary` storage for short-lived
nonces. See [contracts/escrow_contract/src/storage.rs](../contracts/escrow_contract/src/storage.rs).

**Authorization (`require_auth`)**
A Soroban host call that enforces that a specific `Address` signed the current
transaction. Trustchain calls `client.require_auth()` before releasing funds and
`contractor.require_auth()` before submitting milestones.

**Simulation**
A dry-run of a Soroban invocation via Soroban RPC that returns estimated resource
usage and the expected return value without committing to the ledger. The frontend
always simulates before broadcasting to catch errors early.

**Footprint**
The set of ledger entries a Soroban transaction declares it will read or write.
The Soroban host validates that the transaction only accesses entries in its
declared footprint, preventing unexpected side effects.

---

## API and Backend Terms

**Bearer JWT**
A JSON Web Token passed as `Authorization: Bearer <token>` on every authenticated
API request. Tokens are issued by `POST /api/v1/auth/login` and expire after a
configurable interval. Refresh logic is handled automatically by the frontend API
client in `frontend/lib/api/client.js`.

**Tenant**
A logical namespace that isolates escrow data, API keys, and webhook subscriptions
for a single organisation or product integrating Trustchain. See
[docs/multi-tenant-architecture.md](multi-tenant-architecture.md).

**BullMQ**
The Redis-backed job queue used by Trustchain's backend to deliver webhook callbacks
with exponential backoff and dead-letter visibility. See [docs/webhooks.md](webhooks.md).

**Cursor-based Pagination**
The pagination strategy used by all list endpoints (e.g. `GET /api/v1/escrows`).
Instead of page numbers, each response includes an opaque `nextCursor` token derived
from the last returned row's primary key, ensuring stable results even when rows are
inserted concurrently.

**Prisma**
The TypeScript ORM used by Trustchain's backend. Schema definitions live in
`backend/database/schema.prisma`; migration history is stored in
`backend/database/migrations/`.

---

## Cross-References

- [Escrow Creation and Release Flow Guide](escrow-creation-release-guide.md)
- [Dispute Resolution Guide](dispute-resolution-guide.md)
- [Smart Contract ABI & Function Reference](smart-contract-abi.md)
- [Reputation Scoring](reputation-scoring.md)
- [Webhooks](webhooks.md)
- [Multi-Tenant Architecture](multi-tenant-architecture.md)
- [Stellar Network Integration](stellar-network-integration.md)
