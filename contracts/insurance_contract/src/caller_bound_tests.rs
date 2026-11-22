//! Caller and bound checks for `pending_yield_view` and `get_slash_proposal`.
//!
//! Both are read-only and take no caller; the tests run them with auth mocks
//! cleared to prove no authorization is needed, and push the numeric inputs
//! to their extremes. Fallible calls use the `try_` client so a host panic
//! shows up as `Err(Err(_))` and fails the assertions.

#[cfg(test)]
#[allow(clippy::module_inception)]
mod caller_bound_tests {
    use crate::types::DataKey;
    use crate::{
        InsuranceContract, InsuranceContractClient, InsuranceError, SlashStatus, StakeRecord,
    };
    use soroban_sdk::{testutils::Address as _, token, Address, Env, String};

    struct Setup {
        env: Env,
        admin: Address,
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
            admin,
            token_id,
            contract_id,
            client,
        }
    }

    // ── pending_yield_view ────────────────────────────────────────────────────

    #[test]
    fn test_pending_yield_view_unknown_staker_returns_zero_without_auth() {
        let s = setup(true);
        s.env.set_auths(&[]);
        let stranger = Address::generate(&s.env);
        assert_eq!(s.client.pending_yield_view(&stranger), 0);
    }

    #[test]
    fn test_pending_yield_view_reports_staker_share_only() {
        let s = setup(true);
        let staker = Address::generate(&s.env);
        let other = Address::generate(&s.env);
        token::StellarAssetClient::new(&s.env, &s.token_id).mint(&staker, &1_000);
        s.client.stake(&staker, &1_000_i128);
        token::StellarAssetClient::new(&s.env, &s.token_id).mint(&s.contract_id, &400);
        s.client.add_platform_fees(&s.admin, &400_i128);

        s.env.set_auths(&[]);
        assert_eq!(s.client.pending_yield_view(&staker), 400);
        assert_eq!(s.client.pending_yield_view(&other), 0);
    }

    #[test]
    fn test_pending_yield_view_extreme_values_do_not_panic() {
        let s = setup(true);
        let staker = Address::generate(&s.env);
        let cases = [
            // (amount, reward_debt, accumulator)
            (0_i128, 0_i128, i128::MAX),
            (i128::MAX, 0, i128::MAX),
            (i128::MAX, i128::MIN, i128::MAX),
        ];
        for (amount, reward_debt, acc) in cases {
            s.env.as_contract(&s.contract_id, || {
                s.env.storage().persistent().set(
                    &DataKey::Stake(staker.clone()),
                    &StakeRecord {
                        staker: staker.clone(),
                        amount,
                        reward_debt,
                    },
                );
                s.env
                    .storage()
                    .instance()
                    .set(&DataKey::YieldAccumulator, &acc);
            });
            let result = s.client.try_pending_yield_view(&staker);
            assert!(
                result.is_ok(),
                "pending_yield_view panicked for amount={amount} debt={reward_debt} acc={acc}"
            );
        }
    }

    // ── get_slash_proposal ────────────────────────────────────────────────────

    #[test]
    fn test_get_slash_proposal_missing_zero_and_max_id_return_error() {
        let s = setup(true);
        s.env.set_auths(&[]);
        for id in [0_u32, u32::MAX] {
            let result = s.client.try_get_slash_proposal(&id);
            assert!(
                matches!(result, Err(Ok(InsuranceError::SlashProposalNotFound))),
                "get_slash_proposal({id}) must return SlashProposalNotFound"
            );
        }
    }

    #[test]
    fn test_get_slash_proposal_uninitialized_returns_error() {
        let s = setup(false);
        let result = s.client.try_get_slash_proposal(&0_u32);
        assert!(matches!(result, Err(Ok(InsuranceError::NotInitialized))));
    }

    #[test]
    fn test_get_slash_proposal_returns_existing_proposal_without_auth() {
        let s = setup(true);
        let gov = Address::generate(&s.env);
        s.client.add_governor(&s.admin, &gov);
        let id = s
            .client
            .propose_slash(&gov, &500_u32, &String::from_str(&s.env, "exploit"));

        s.env.set_auths(&[]);
        let proposal = s.client.get_slash_proposal(&id);
        assert_eq!(proposal.id, id);
        assert_eq!(proposal.status, SlashStatus::Pending);
    }
}
