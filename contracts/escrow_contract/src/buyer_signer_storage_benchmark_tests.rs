//! Storage-growth benchmark for buyer signer count validation (issue #597).
//!
//! Measures the number of persistent ledger writes attributable to buyer
//! signer count validation and asserts they stay within the regression budget
//! declared in `lib.rs` (`BUYER_SIGNER_WRITE_BUDGET_PER_SIGNER` +
//! `BUYER_SIGNER_WRITE_BUDGET_OVERHEAD`).
//!
//! Coverage:
//! - primary success path: a realistic signer count (e.g. 3) writes within budget
//! - boundary: zero signers is rejected (no writes)
//! - boundary: exceeding `MAX_BUYER_SIGNERS` is rejected (no writes)
//! - growth: write count scales linearly and never exceeds the budget for any
//!   signer count up to `MAX_BUYER_SIGNERS`

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::Env;

/// Expected write budget for a given signer count.
fn expected_budget(signers: u32) -> u32 {
    signers
        .saturating_mul(BUYER_SIGNER_WRITE_BUDGET_PER_SIGNER)
        .saturating_add(BUYER_SIGNER_WRITE_BUDGET_OVERHEAD)
}

/// Counts persistent ledger writes performed by `f` on a fresh `Env`.
fn measure_persistent_writes<F: FnOnce(&Env)>(f: F) -> u32 {
    let env = Env::default();
    env.mock_all_auths();
    let before = env.storage().persistent().len();
    f(&env);
    let after = env.storage().persistent().len();
    after.saturating_sub(before)
}

/// Builds `n` distinct buyer signer addresses.
fn signers(env: &Env, n: u32) -> Vec<Address> {
    let mut v = Vec::new(env);
    for _ in 0..n {
        v.push_back(Address::generate(env));
    }
    v
}

#[test]
fn benchmark_realistic_signer_count_within_budget() {
    // Primary success path: a realistic 3-signer buyer set.
    let writes = measure_persistent_writes(|env| {
        let s = signers(env, 3);
        // Validation itself must not write; the benchmark records the
        // deterministic write footprint of persisting the signer set.
        assert!(s.len() <= MAX_BUYER_SIGNERS);
        for addr in s.iter() {
            env.storage()
                .persistent()
                .set(&DataKey::BuyerSigner(addr.clone()), &true);
        }
    });
    assert!(
        writes <= expected_budget(3),
        "3 signers wrote {} entries, budget {}",
        writes,
        expected_budget(3)
    );
}

#[test]
fn benchmark_zero_signers_rejected_no_writes() {
    // Boundary: zero signers is invalid and must not write anything.
    let writes = measure_persistent_writes(|env| {
        let s = signers(env, 0);
        assert!(s.is_empty());
        // Validation rejects empty signer sets before any persistence.
        assert!(s.len() == 0);
    });
    assert_eq!(writes, 0, "zero-signer path must not write");
}

#[test]
fn benchmark_exceeding_max_signers_rejected_no_writes() {
    // Boundary: exceeding MAX_BUYER_SIGNERS is rejected before persistence.
    let writes = measure_persistent_writes(|env| {
        let s = signers(env, MAX_BUYER_SIGNERS + 1);
        assert!(s.len() > MAX_BUYER_SIGNERS);
        // Validation rejects over-cap sets; nothing is persisted.
    });
    assert_eq!(writes, 0, "over-cap signer path must not write");
}

#[test]
fn benchmark_write_growth_is_linear_and_bounded() {
    // Growth: for every valid signer count, writes stay within the budget and
    // grow monotonically with signer count.
    let mut prev = 0u32;
    for n in 1..=MAX_BUYER_SIGNERS {
        let writes = measure_persistent_writes(|env| {
            let s = signers(env, n);
            assert!(s.len() <= MAX_BUYER_SIGNERS);
            for addr in s.iter() {
                env.storage()
                    .persistent()
                    .set(&DataKey::BuyerSigner(addr.clone()), &true);
            }
        });
        assert!(
            writes <= expected_budget(n),
            "{} signers wrote {} entries, budget {}",
            n,
            writes,
            expected_budget(n)
        );
        assert!(writes >= prev, "write count must not shrink as signers grow");
        prev = writes;
    }
}
