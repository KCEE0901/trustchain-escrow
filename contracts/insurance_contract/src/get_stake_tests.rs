//! Caller and bound checks for `get_stake`.
//!
//! `get_stake` is read-only and takes no caller, so the tests run it with
//! auth mocks cleared to show no authorization is needed, and check stored
//! amounts at `0` and `i128::MAX`. The `try_` client turns a host panic into
//! `Err(Err(_))`, which fails the `Ok(Ok(_))` assertions.

use crate::types::DataKey;
use crate::{InsuranceContract, InsuranceContractClient, StakeRecord};
use soroban_sdk::{testutils::Address as _, token, Address, Env};

struct Setup {
    env: Env,
    token_id: Address,
    contract_id: Address,
    client: InsuranceContractClient<'static>,
}

fn setup(init: bool) -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let contract_id = env.register_contract(None, InsuranceContract);
    let client = InsuranceContractClient::new(&env, &contract_id);
    if init {
        client.initialize(&admin, &token_id, &10_i128, &10_000_i128, &2_u32);
    }
    Setup {
        env,
        token_id,
        contract_id,
        client,
    }
}

fn write_stake(s: &Setup, staker: &Address, amount: i128) {
    s.env.as_contract(&s.contract_id, || {
        s.env.storage().persistent().set(
            &DataKey::Stake(staker.clone()),
            &StakeRecord {
                staker: staker.clone(),
                amount,
                reward_debt: 0,
            },
        );
    });
}

#[test]
fn test_get_stake_returns_staker_amount_without_auth() {
    let s = setup(true);
    let staker = Address::generate(&s.env);
    token::StellarAssetClient::new(&s.env, &s.token_id).mint(&staker, &1_000);
    s.client.stake(&staker, &1_000_i128);

    s.env.set_auths(&[]);
    assert_eq!(s.client.try_get_stake(&staker), Ok(Ok(1_000)));
}

#[test]
fn test_get_stake_other_address_returns_zero() {
    let s = setup(true);
    let staker = Address::generate(&s.env);
    let other = Address::generate(&s.env);
    token::StellarAssetClient::new(&s.env, &s.token_id).mint(&staker, &500);
    s.client.stake(&staker, &500_i128);

    s.env.set_auths(&[]);
    assert_eq!(s.client.try_get_stake(&other), Ok(Ok(0)));
}

#[test]
fn test_get_stake_zero_and_max_amounts_do_not_panic() {
    let s = setup(true);
    let staker = Address::generate(&s.env);
    s.env.set_auths(&[]);
    for amount in [0_i128, i128::MAX] {
        write_stake(&s, &staker, amount);
        assert_eq!(s.client.try_get_stake(&staker), Ok(Ok(amount)));
    }
}

#[test]
fn test_get_stake_uninitialized_contract_returns_zero() {
    let s = setup(false);
    let staker = Address::generate(&s.env);
    assert_eq!(s.client.try_get_stake(&staker), Ok(Ok(0)));
}
