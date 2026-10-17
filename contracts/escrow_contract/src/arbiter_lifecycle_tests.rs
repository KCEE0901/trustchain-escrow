#[cfg(test)]
mod arbiter_lifecycle_tests {
    use soroban_sdk::{testutils::Address as _, token, Address, BytesN, Env, Vec};

    use crate::{EscrowContract, EscrowContractClient, EscrowError, MultisigConfig};

    fn no_multisig(env: &Env) -> MultisigConfig {
        MultisigConfig {
            approvers: Vec::new(env),
            weights: Vec::new(env),
            threshold: 0,
        }
    }

    fn setup() -> (Env, Address, EscrowContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &contract_id);
        contract.initialize(&admin);
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        (env, admin, contract, token_id)
    }

    fn fund(env: &Env, token_id: &Address, client: &Address) {
        token::StellarAssetClient::new(env, token_id).mint(client, &530);
    }

    #[test]
    fn fuzz_arbiter_selection_preserves_identity_invariants() {
        let mut state = 0xA11B_17E5_u64;
        for case in 0_u8..48 {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;

            let (env, admin, contract, token_id) = setup();
            let client = Address::generate(&env);
            let freelancer = Address::generate(&env);
            let outsider = Address::generate(&env);
            fund(&env, &token_id, &client);

            let category = state % 4;
            let arbiter = match category {
                0 => client.clone(),
                1 => freelancer.clone(),
                _ => outsider.clone(),
            };
            if category == 2 {
                contract.add_to_arbiter_allowlist(&admin, &arbiter);
            }

            let result = contract.try_create_escrow(
                &client,
                &freelancer,
                &token_id,
                &500,
                &BytesN::from_array(&env, &[case.saturating_add(1); 32]),
                &Some(arbiter.clone()),
                &None,
                &None,
                &None,
                &no_multisig(&env),
                &None,
            );

            match category {
                0 | 1 => assert!(matches!(result, Err(Ok(EscrowError::E3)))),
                2 => {
                    let escrow_id = result.expect("allowlisted independent arbiter must succeed");
                    assert_eq!(contract.get_escrow(&escrow_id).arbiter, Some(arbiter));
                }
                _ => assert!(matches!(result, Err(Ok(EscrowError::E90)))),
            }
        }
    }
}
