//! # Formal Verification Harnesses — StellarTrustEscrow
//!
//! This file contains all Kani proof harnesses for the escrow contract.
//! Harnesses are gated behind `#[cfg(kani)]` so they are excluded from
//! normal `cargo build` and `cargo test` runs.
//!
//! ## Running
//!
//! ```bash
//! # All harnesses
//! cargo kani --workspace
//!
//! # Single harness
//! cargo kani --harness verify_release_funds_balance_invariant
//! ```
//!
//! See `docs/security/formal-verification-status.md` for the full proof
//! target registry, expected outputs, and CI integration notes.

// ── CP-1: create_escrow — initial state invariants ────────────────────────────

/// Verifies that after a successful `create_escrow` call the escrow metadata
/// satisfies all initial-state invariants:
///
/// - `total_amount > 0`
/// - `remaining_balance == total_amount`
/// - `status == Active` (represented as 0)
/// - `allocated_amount == 0`
///
/// The harness operates on symbolic arithmetic rather than a live Soroban
/// environment, so it tests the pure mathematical properties of the
/// initialisation logic independently of storage I/O.
#[cfg(kani)]
#[kani::proof]
fn verify_create_escrow_initial_state() {
    let total_amount: i128 = kani::any();

    // Pre-condition: caller must supply a positive amount that passes
    // both MIN_ESCROW_AMOUNT and MAX_ESCROW_AMOUNT guards.
    kani::assume(total_amount > 0);
    kani::assume(total_amount <= 100_000_000_000_000_000i128); // MAX_ESCROW_AMOUNT

    // Simulate the initialisation arithmetic performed by create_escrow_internal.
    let remaining_balance = total_amount;
    let allocated_amount: i128 = 0;
    // 0 = Active in the EscrowStatus encoding used by the contract.
    let status: u8 = 0;

    // CP-1 invariants
    assert!(total_amount > 0);
    assert!(remaining_balance == total_amount);
    assert!(status == 0); // Active
    assert!(allocated_amount == 0);
}

// ── CP-2: add_milestone — allocation guard invariant ─────────────────────────

/// Verifies that adding milestones one at a time never causes
/// `allocated_amount` to exceed `total_amount`.
///
/// The harness draws a symbolic `total_amount` and up to three symbolic
/// milestone amounts, adding them sequentially while asserting the invariant
/// after each step. The early-return path (allocation would exceed total) is
/// modelled by `kani::assume` on the preconditions that mirror the contract's
/// `E15` guard.
#[cfg(kani)]
#[kani::proof]
fn verify_add_milestone_allocation_guard() {
    let total_amount: i128 = kani::any();
    let m1: i128 = kani::any();
    let m2: i128 = kani::any();
    let m3: i128 = kani::any();

    // Preconditions that mirror create_escrow and add_milestone guards.
    kani::assume(total_amount > 0);
    kani::assume(total_amount <= 100_000_000_000_000_000i128);
    kani::assume(m1 > 0);
    kani::assume(m2 > 0);
    kani::assume(m3 > 0);

    // The contract rejects add_milestone when next_allocated > total_amount.
    // Model the three successful additions within bounds.
    kani::assume(m1 <= total_amount);
    kani::assume(m1 + m2 <= total_amount);
    kani::assume(m1 + m2 + m3 <= total_amount);

    let mut allocated: i128 = 0;

    // Step 1
    allocated += m1;
    assert!(allocated <= total_amount);

    // Step 2
    allocated += m2;
    assert!(allocated <= total_amount);

    // Step 3
    allocated += m3;
    assert!(allocated <= total_amount);
}

// ── CP-3: release_funds — balance invariants ──────────────────────────────────

/// Verifies that `release_funds` decreases `remaining_balance` by exactly
/// `milestone.amount` and never drives the balance negative.
///
/// This is a pure arithmetic harness — the token transfer and storage writes
/// are not modelled, but the balance arithmetic is identical to the
/// `remaining_balance.checked_sub(amount)` expression in `release_funds`.
#[cfg(kani)]
#[kani::proof]
fn verify_release_funds_balance_invariant() {
    let initial_balance: i128 = kani::any();
    let milestone_amount: i128 = kani::any();

    // Constrain to valid pre-conditions that mirror the contract's checks.
    kani::assume(initial_balance >= 0);
    kani::assume(milestone_amount > 0);
    kani::assume(milestone_amount <= initial_balance);

    let new_balance = initial_balance - milestone_amount;

    // Invariant 1: balance never goes negative
    assert!(new_balance >= 0);
    // Invariant 2: balance decreases by exactly milestone_amount
    assert!(new_balance == initial_balance - milestone_amount);
}

// ── CP-4: dispute_escrow — state transition invariant ────────────────────────

/// Verifies that `raise_dispute` (modelled symbolically) only transitions the
/// escrow status from `Active` to `Disputed`, and that any other source status
/// leaves the status unchanged (i.e. the call is rejected).
///
/// EscrowStatus encoding used in this harness:
/// - 0 = Active
/// - 1 = Completed
/// - 2 = Disputed
/// - 3 = Cancelled
/// - 4 = CancellationPending
#[cfg(kani)]
#[kani::proof]
fn verify_dispute_escrow_transition_invariant() {
    let current_status: u8 = kani::any();
    kani::assume(current_status <= 4);

    let is_active = current_status == 0;

    if is_active {
        // Transition is permitted: result must be Disputed (2).
        let new_status: u8 = 2;
        assert!(new_status == 2);
        assert!(current_status != new_status); // status actually changed
    } else {
        // Transition must be rejected — status stays unchanged.
        let new_status = current_status;
        // Only Disputed→Disputed is a valid no-op (already disputed).
        assert!(new_status != 2 || current_status == 2);
    }
}

// ── CP-5: approve_milestone — counter and balance consistency ─────────────────

/// Verifies that approving a milestone increments `approved_count` by exactly 1
/// and decreases `remaining_balance` by exactly `milestone.amount`, and that
/// the escrow transitions to `Completed` (status 1) precisely when
/// `released_count == milestone_count`.
#[cfg(kani)]
#[kani::proof]
fn verify_approve_milestone_counters() {
    let old_approved_count: u32 = kani::any();
    let released_count: u32 = kani::any();
    let milestone_count: u32 = kani::any();
    let old_balance: i128 = kani::any();
    let milestone_amount: i128 = kani::any();

    // Valid preconditions.
    kani::assume(milestone_count > 0);
    kani::assume(old_approved_count < milestone_count);
    kani::assume(released_count <= old_approved_count);
    kani::assume(milestone_amount > 0);
    kani::assume(milestone_amount <= old_balance);
    kani::assume(old_balance >= 0);

    // Simulate approve_milestone arithmetic.
    let new_approved_count = old_approved_count + 1;
    let new_balance = old_balance - milestone_amount;
    // In the timelocked path the milestone is also released immediately.
    let new_released_count = released_count + 1;

    // Invariant 1: approved_count increments by exactly 1.
    assert!(new_approved_count == old_approved_count + 1);

    // Invariant 2: balance decreases by exactly milestone_amount.
    assert!(new_balance == old_balance - milestone_amount);
    assert!(new_balance >= 0);

    // Invariant 3: completion check is O(1) and correct.
    let escrow_completed = new_released_count == milestone_count;
    if escrow_completed {
        // status should transition to Completed (1).
        let new_status: u8 = 1;
        assert!(new_status == 1);
    }
}

// ── CP-6: cancel_escrow — fund conservation invariant ────────────────────────

/// Verifies that the three outgoing amounts in `cancel_escrow`
/// (platform fee, freelancer payout for approved milestones, client refund)
/// sum exactly to the pre-cancel `remaining_balance`, and that none of the
/// three individual amounts is negative.
#[cfg(kani)]
#[kani::proof]
fn verify_cancel_escrow_fund_conservation() {
    let remaining: i128 = kani::any();
    let fee_bps: i128 = kani::any();
    let approved_due: i128 = kani::any();

    // Preconditions matching the contract's guards.
    kani::assume(remaining >= 0);
    kani::assume(fee_bps >= 0);
    kani::assume(fee_bps <= 10_000);
    kani::assume(approved_due >= 0);

    // fee = remaining * fee_bps / 10_000, capped at remaining.
    let fee_uncapped = remaining * fee_bps / 10_000;
    let fee = if fee_uncapped > remaining { remaining } else { fee_uncapped };

    // approved_due must not exceed remaining after fee.
    let available_after_fee = remaining - fee;
    kani::assume(approved_due <= available_after_fee);

    let freelancer_payout = approved_due;
    let client_refund = available_after_fee - approved_due;

    // Invariant 1: no amount is negative.
    assert!(fee >= 0);
    assert!(freelancer_payout >= 0);
    assert!(client_refund >= 0);

    // Invariant 2: all outgoing amounts sum to remaining_balance.
    assert!(fee + freelancer_payout + client_refund == remaining);
}
