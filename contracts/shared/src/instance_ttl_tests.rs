//! Tests for `bump_instance_ttl`.
//!
//! The helper takes no caller and no numeric argument; these tests check it
//! runs without authorization, extends the instance TTL to the shared target,
//! and does not panic when called repeatedly or after the TTL has run low.

use super::*;
use soroban_sdk::{
    contract,
    testutils::{storage::Instance as _, Ledger},
    Env,
};

#[contract]
struct InstanceTtlTestContract;

#[test]
fn test_bump_instance_ttl_extends_to_shared_target_without_auth() {
    let env = Env::default();
    let id = env.register_contract(None, InstanceTtlTestContract);
    env.as_contract(&id, || {
        bump_instance_ttl(&env);
        assert!(env.storage().instance().get_ttl() >= INSTANCE_TTL_EXTEND_TO);
    });
}

#[test]
fn test_bump_instance_ttl_repeated_calls_do_not_panic() {
    let env = Env::default();
    let id = env.register_contract(None, InstanceTtlTestContract);
    env.as_contract(&id, || {
        bump_instance_ttl(&env);
        bump_instance_ttl(&env);
        assert!(env.storage().instance().get_ttl() >= INSTANCE_TTL_EXTEND_TO);
    });
}

#[test]
fn test_bump_instance_ttl_after_ledgers_advance() {
    let env = Env::default();
    let id = env.register_contract(None, InstanceTtlTestContract);
    env.as_contract(&id, || bump_instance_ttl(&env));
    env.ledger()
        .with_mut(|l| l.sequence_number += INSTANCE_TTL_EXTEND_TO - INSTANCE_TTL_THRESHOLD);
    env.as_contract(&id, || {
        bump_instance_ttl(&env);
        assert!(env.storage().instance().get_ttl() >= INSTANCE_TTL_EXTEND_TO);
    });
}
