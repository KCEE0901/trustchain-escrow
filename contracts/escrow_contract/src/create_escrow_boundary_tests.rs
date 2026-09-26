//! Boundary tests for create_escrow inputs.
//!
//! These are deterministic boundary cases that cover the same invariants a
//! property-based fuzz harness should generate: non-positive amounts and
//! over-maximum amounts must not create escrow state.

#[cfg(test)]
mod create_escrow_boundary_tests {
    use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

    use crate::{EscrowContract, EscrowContractClient, EscrowError, MultisigConfig, MAX_ESCROW_AMOUNT};

    fn no_multisig(env: &Env) -> MultisigConfig {
        MultisigConfig {
            approvers: soroban_sdk::Vec::new(env),
            weights: soroban_sdk::Vec::new(env),
            threshold: 0,
        }
    }

    #[test]
    fn create_escrow_rejects_amount_boundaries() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let contract_id = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &contract_id);
        contract.initialize(&admin);

        for amount in [0_i128, -1_i128, MAX_ESCROW_AMOUNT + 1] {
            let result = contract.try_create_escrow(
                &client,
                &freelancer,
                &token_id,
                &amount,
                &BytesN::from_array(&env, &[7; 32]),
                &None,
                &None,
                &None,
                &None,
                &no_multisig(&env),
            );
            assert!(result.is_err(), "amount {amount} should be rejected");
        }

        assert_eq!(contract.escrow_count(), 0);
    }
}
