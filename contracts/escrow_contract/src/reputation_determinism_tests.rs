#[cfg(test)]
mod reputation_determinism_tests {
    use crate::{EscrowContract, EscrowContractClient};
    use soroban_sdk::{testutils::Address as _, Address, Env};

    #[test]
    fn fuzz_reputation_scoring_is_deterministic_and_saturating() {
        for seed in 0_u64..64 {
            let env = Env::default();
            env.mock_all_auths();
            let admin = Address::generate(&env);
            let user = Address::generate(&env);
            let id = env.register_contract(None, EscrowContract);
            let client = EscrowContractClient::new(&env, &id);
            client.initialize(&admin);
            let volume = i128::from((seed * 7919) % 50_000);
            client.update_reputation(&user, &true, &false, &volume);
            let first = client.get_reputation(&user);
            assert_eq!(first.total_score, 10 + ((volume / 1_000).min(10) as u64));
            client.update_reputation(&user, &false, &true, &0);
            assert_eq!(
                client.get_reputation(&user).total_score,
                first.total_score.saturating_sub(5)
            );
        }
    }
}
