//! # Shared Constants — StellarTrustEscrow
//!
//! Common constants and configuration shared across all contracts in the
//! StellarTrustEscrow workspace.

#![no_std]
#![deny(warnings)]

use soroban_sdk::{Env, IntoVal, Val};

pub mod auth;
#[cfg(test)]
mod instance_ttl_tests;

// ── TTL constants ─────────────────────────────────────────────────────────────

/// Bump instance storage TTL when remaining ledgers fall below this threshold.
pub const INSTANCE_TTL_THRESHOLD: u32 = 5_000;

/// Extend instance storage TTL to this value on bump.
pub const INSTANCE_TTL_EXTEND_TO: u32 = 50_000;

/// Bump persistent storage TTL when remaining ledgers fall below this threshold.
pub const PERSISTENT_TTL_THRESHOLD: u32 = 5_000;

/// Extend persistent storage TTL to this value on bump.
pub const PERSISTENT_TTL_EXTEND_TO: u32 = 50_000;

/// Bump instance TTL using shared config constants.
#[inline]
pub fn bump_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
}

/// Bump persistent TTL using shared config constants.
///
/// A missing key is a no-op: extending the TTL of an entry that does not
/// exist would otherwise trap the host and abort the calling contract.
#[inline]
pub fn bump_persistent_ttl<K>(env: &Env, key: &K)
where
    K: IntoVal<Env, Val>,
{
    let storage = env.storage().persistent();
    if storage.has(key) {
        storage.extend_ttl(key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
    }
}

// ── Escrow limits ─────────────────────────────────────────────────────────────

/// Maximum number of milestones per escrow.
pub const MAX_MILESTONES: u32 = 50;

/// Maximum number of buyer signers per escrow.
pub const MAX_BUYER_SIGNERS: u32 = 3;

/// Required approvals from buyer signers (2-of-N).
pub const REQUIRED_BUYER_APPROVALS: u32 = 2;

// ── Timing constants ──────────────────────────────────────────────────────────

/// Dispute window for cancellation requests (~6 days at 5 s/ledger).
pub const CANCELLATION_DISPUTE_PERIOD: u64 = 120_960;

/// Dispute window for slash records (~6 days).
pub const SLASH_DISPUTE_PERIOD: u64 = 51_840;

/// Slash penalty as a percentage of remaining balance.
pub const SLASH_PERCENTAGE: u64 = 10;

// ── Storage rent ──────────────────────────────────────────────────────────────

/// One rent period in seconds (1 day).
pub const RENT_PERIOD_SECONDS: u64 = 86_400;

/// Number of periods to reserve rent for upfront.
pub const RENT_RESERVE_PERIODS: u64 = 30;

/// Rent cost per storage entry per period (in token base units).
pub const RENT_PER_ENTRY_PER_PERIOD: i128 = 1;

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{contract, testutils::storage::Persistent as _, Env};

    #[contract]
    struct TtlTestContract;

    #[test]
    fn test_bump_persistent_ttl_extends_existing_entry() {
        let env = Env::default();
        let id = env.register_contract(None, TtlTestContract);
        env.as_contract(&id, || {
            let key = 7u32;
            env.storage().persistent().set(&key, &true);
            bump_persistent_ttl(&env, &key);
            assert!(env.storage().persistent().get_ttl(&key) >= PERSISTENT_TTL_EXTEND_TO);
        });
    }

    #[test]
    fn test_bump_persistent_ttl_missing_key_does_not_panic() {
        let env = Env::default();
        let id = env.register_contract(None, TtlTestContract);
        env.as_contract(&id, || {
            let key = 42u32;
            bump_persistent_ttl(&env, &key);
            assert!(!env.storage().persistent().has(&key));
        });
    }

    #[test]
    fn test_bump_persistent_ttl_zero_and_max_keys() {
        let env = Env::default();
        let id = env.register_contract(None, TtlTestContract);
        env.as_contract(&id, || {
            for key in [0u64, u64::MAX] {
                // Missing entry: no panic, nothing created.
                bump_persistent_ttl(&env, &key);
                assert!(!env.storage().persistent().has(&key));

                // Existing entry: TTL extended to the shared target.
                env.storage().persistent().set(&key, &1u32);
                bump_persistent_ttl(&env, &key);
                assert!(env.storage().persistent().get_ttl(&key) >= PERSISTENT_TTL_EXTEND_TO);
            }
        });
    }
}
