#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

fn setup(env: &Env) -> (InsuranceContractClient, Address, Address) {
    env.mock_all_auths();
    let contract_id = env.register_contract(None, InsuranceContract);
    let client = InsuranceContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let holder = Address::generate(env);
    client.initialize(&admin);
    (client, admin, holder)
}

#[test]
fn test_reserve_solvency_success_path() {
    let env = Env::default();
    let (client, _admin, holder) = setup(&env);

    client.deposit_reserve(&holder, &1_000);
    client.record_claim(&holder, &250);

    assert_eq!(client.reserve_balance(&holder), 750);
    assert!(client.is_solvent(&holder));
}

#[test]
fn test_reserve_solvency_insufficient_reserve() {
    let env = Env::default();
    let (client, _admin, holder) = setup(&env);

    client.deposit_reserve(&holder, &100);
    let result = client.try_record_claim(&holder, &500);

    assert!(result.is_err());
    assert_eq!(client.reserve_balance(&holder), 100);
}

#[test]
fn test_reserve_solvency_zero_deposit_boundary() {
    let env = Env::default();
    let (client, _admin, holder) = setup(&env);

    let result = client.try_deposit_reserve(&holder, &0);
    assert!(result.is_err());
    assert_eq!(client.reserve_balance(&holder), 0);
}

/// Storage-growth benchmark for insurance reserve solvency.
///
/// Measures the number of ledger entries written per reserve operation for a
/// realistic workload and asserts it stays within a fixed regression budget.
/// The budget is deterministic so the test fails loudly if storage growth
/// regresses beyond the agreed ceiling.
#[test]
fn test_reserve_solvency_storage_growth_budget() {
    let env = Env::default();
    let (client, _admin, holder) = setup(&env);

    // Regression budget: maximum ledger entries written per reserve operation.
    const MAX_ENTRIES_PER_OP: u32 = 4;
    const OPERATIONS: u32 = 20;

    let before = env.storage().get_entries_count();

    for i in 0..OPERATIONS {
        client.deposit_reserve(&holder, &(100 + i as i128));
        client.record_claim(&holder, &50);
    }

    let after = env.storage().get_entries_count();
    let written = after.saturating_sub(before);
    let per_op = written / (OPERATIONS * 2);

    assert!(
        per_op <= MAX_ENTRIES_PER_OP,
        "storage growth regression: {} entries/op exceeds budget of {}",
        per_op,
        MAX_ENTRIES_PER_OP
    );

    // Solvency must hold after the full workload.
    assert!(client.is_solvent(&holder));
}
