# Formal Verification Proof Target Status

This document tracks the status of every Kani proof harness in the
`contracts/` workspace. It replaces the placeholder examples that were in
`formal-verification.md` with a concrete, per-target record of:

- **Proof target** — the invariant or property being verified
- **Status** — `PASSING`, `SKIPPED`, or `TODO`
- **Harness** — the Rust function name gated behind `#[cfg(kani)]`
- **Command** — the exact `cargo kani` invocation to run or reproduce the proof
- **Owner** — the team / contributor responsible for maintaining this harness
- **Expected output** — what a passing run looks like

See [`docs/security/formal-verification.md`](./formal-verification.md) for
tool setup, invariant definitions, and PR requirements.

---

## How to Run All Proofs

```bash
# From the repository root — runs every harness in the contracts workspace
cargo kani --workspace
```

To run a single harness:

```bash
cargo kani --harness <harness_name>
```

Harnesses are gated behind `#[cfg(kani)]` and are excluded from `cargo
build` and `cargo test`.

---

## Proof Target Registry

### CP-1 · `create_escrow` — initial state invariants

| Field   | Value                                                           |
| ------- | --------------------------------------------------------------- |
| Status  | **PASSING**                                                     |
| Harness | `verify_create_escrow_initial_state`                            |
| File    | `contracts/escrow_contract/src/formal_verification.rs`          |
| Command | `cargo kani --harness verify_create_escrow_initial_state`       |
| Owner   | smart-contracts team                                            |

**Invariants:**

| Invariant                                         | Expression                                    |
| ------------------------------------------------- | --------------------------------------------- |
| Total amount is positive                          | `meta.total_amount > 0`                       |
| Remaining balance equals total amount at creation | `meta.remaining_balance == meta.total_amount` |
| Status is Active immediately after creation       | `meta.status == EscrowStatus::Active`         |
| Allocated amount is zero at creation              | `meta.allocated_amount == 0`                  |

**Expected output:**

```
VERIFICATION:- SUCCESSFUL
Verification Time: <seconds>s
```

---

### CP-2 · `add_milestone` — allocation guard invariant

| Field   | Value                                                           |
| ------- | --------------------------------------------------------------- |
| Status  | **PASSING**                                                     |
| Harness | `verify_add_milestone_allocation_guard`                         |
| File    | `contracts/escrow_contract/src/formal_verification.rs`          |
| Command | `cargo kani --harness verify_add_milestone_allocation_guard`    |
| Owner   | smart-contracts team                                            |

**Invariants:**

| Invariant                                   | Expression                                   |
| ------------------------------------------- | -------------------------------------------- |
| Allocated amount never exceeds total amount | `meta.allocated_amount <= meta.total_amount` |

This invariant must hold after each individual `add_milestone` call, not
just at the end of a batch. The harness models the allocation arithmetic in
isolation — `total_amount` and a sequence of `milestone_amount` values are
drawn symbolically and the invariant is asserted after each step.

**Expected output:**

```
VERIFICATION:- SUCCESSFUL
Verification Time: <seconds>s
```

---

### CP-3 · `release_funds` — balance invariants

| Field   | Value                                                           |
| ------- | --------------------------------------------------------------- |
| Status  | **PASSING**                                                     |
| Harness | `verify_release_funds_balance_invariant`                        |
| File    | `contracts/escrow_contract/src/formal_verification.rs`          |
| Command | `cargo kani --harness verify_release_funds_balance_invariant`   |
| Owner   | smart-contracts team                                            |

**Invariants:**

| Invariant                                                   | Expression                                      |
| ----------------------------------------------------------- | ----------------------------------------------- |
| Remaining balance decreases by exactly the milestone amount | `new_balance == old_balance - milestone.amount` |
| Remaining balance never goes negative                       | `new_balance >= 0`                              |

**Expected output:**

```
VERIFICATION:- SUCCESSFUL
Verification Time: <seconds>s
```

---

### CP-4 · `dispute_escrow` — state transition invariant

| Field   | Value                                                              |
| ------- | ------------------------------------------------------------------ |
| Status  | **PASSING**                                                        |
| Harness | `verify_dispute_escrow_transition_invariant`                       |
| File    | `contracts/escrow_contract/src/formal_verification.rs`             |
| Command | `cargo kani --harness verify_dispute_escrow_transition_invariant`  |
| Owner   | smart-contracts team                                               |

**Invariants:**

| Invariant                                           | Expression                                      |
| --------------------------------------------------- | ----------------------------------------------- |
| Status transitions only from `Active` to `Disputed` | `old_status == Active → new_status == Disputed` |
| No other status transition is permitted             | `old_status != Active → call must be rejected`  |

**Expected output:**

```
VERIFICATION:- SUCCESSFUL
Verification Time: <seconds>s
```

---

### CP-5 · `approve_milestone` — counter and balance consistency

| Field   | Value                                                           |
| ------- | --------------------------------------------------------------- |
| Status  | **PASSING**                                                     |
| Harness | `verify_approve_milestone_counters`                             |
| File    | `contracts/escrow_contract/src/formal_verification.rs`          |
| Command | `cargo kani --harness verify_approve_milestone_counters`        |
| Owner   | smart-contracts team                                            |

**Invariants:**

| Invariant                                                      | Expression                                      |
| -------------------------------------------------------------- | ----------------------------------------------- |
| `approved_count` increments by exactly 1 per approval         | `new_approved_count == old_approved_count + 1`  |
| `remaining_balance` decreases by exactly the milestone amount  | `new_balance == old_balance - milestone.amount` |
| Escrow completes when all milestones are released              | `released_count == milestone_count → Completed` |

**Expected output:**

```
VERIFICATION:- SUCCESSFUL
Verification Time: <seconds>s
```

---

### CP-6 · `cancel_escrow` — fund conservation invariant

| Field   | Value                                                           |
| ------- | --------------------------------------------------------------- |
| Status  | **PASSING**                                                     |
| Harness | `verify_cancel_escrow_fund_conservation`                        |
| File    | `contracts/escrow_contract/src/formal_verification.rs`          |
| Command | `cargo kani --harness verify_cancel_escrow_fund_conservation`   |
| Owner   | smart-contracts team                                            |

**Invariants:**

| Invariant                                                             | Expression                                                |
| --------------------------------------------------------------------- | --------------------------------------------------------- |
| Sum of all outgoing transfers equals pre-cancel remaining balance     | `fee + freelancer_payout + client_refund == remaining`    |
| No payout amount is negative                                          | `fee >= 0 ∧ freelancer_payout >= 0 ∧ client_refund >= 0` |

**Expected output:**

```
VERIFICATION:- SUCCESSFUL
Verification Time: <seconds>s
```

---

## Skipped Targets

The following proof targets have been explicitly deferred. Each entry
documents the reason and the conditions under which it should be revisited.

| Harness (planned)                              | Reason skipped                                                                          | Revisit when                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `verify_batch_release_funds_total`             | Requires modelling a variable-length `Vec` symbolically; Kani support is incomplete.   | Kani adds stable `Vec` symbolic support           |
| `verify_recurring_payment_schedule_invariant`  | Schedule arithmetic spans multiple ledger timestamps; proof state space is too large.  | After schedule logic is extracted to a pure fn    |
| `verify_oracle_resolve_dispute_signature`      | Ed25519 signature verification is a crypto primitive; model checking is not suitable.  | Property testing with `proptest` instead          |
| `verify_slippage_check_bounds`                 | Requires live oracle price as a symbolic input; oracle client is a cross-contract call. | After oracle is stubbed with a pure price fn      |

---

## Adding a New Proof Target

1. Write the harness in `contracts/escrow_contract/src/formal_verification.rs`
   (or the relevant contract source file) gated behind `#[cfg(kani)]`.
2. Run `cargo kani --harness <name>` and confirm `VERIFICATION:- SUCCESSFUL`.
3. Add a row to this document following the template above.
4. Open a PR — the CI job `kani-verify` will re-run all harnesses and fail
   the build if any regression is introduced.

---

## CI Integration

The `kani-verify` job in `.github/workflows/ci.yml` runs:

```yaml
- name: Run Kani proofs
  run: cargo kani --workspace --output-format terse
```

A non-zero exit code from any harness fails the job and blocks merge.
The full proof output is uploaded as a job artifact named `kani-results`.
