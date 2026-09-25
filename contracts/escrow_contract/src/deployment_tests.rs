#[cfg(test)]
mod deployment_tests {
    use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

    use crate::{EscrowContract, EscrowContractClient, EscrowError, MultisigConfig};

    /// Creates a fresh contract that has NOT been initialized.
    fn uninitialized_client() -> (Env, Address, EscrowContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);
        // NOTE: initialize() is deliberately NOT called here.
        (env, admin, client)
    }

    #[test]
    fn test_initialize_with_admin_signers_sets_admin_config() {
        let (env, admin, client) = uninitialized_client();
        let signer_a = Address::generate(&env);
        let signer_b = Address::generate(&env);
        let mut signers = Vec::new(&env);
        signers.push_back(signer_a.clone());
        signers.push_back(signer_b.clone());

        let result = client.try_initialize_with_admin_signers(&admin, &signers, &2u32);
        assert_eq!(result, Ok(Ok(())));

        assert_eq!(client.get_admin(), admin);
        assert_eq!(client.get_admin_threshold(), 2u32);
        let stored_signers = client.get_admin_signers();
        assert_eq!(stored_signers.len(), 2);
        assert_eq!(stored_signers.get(0).unwrap(), signer_a);
        assert_eq!(stored_signers.get(1).unwrap(), signer_b);
        let _ = env;
    }

    #[test]
    fn test_initialize_with_admin_signers_rejects_duplicate_init() {
        let (_env, admin, client) = uninitialized_client();
        let signers = Vec::new(&client.env());

        let first = client.try_initialize_with_admin_signers(&admin, &signers, &1u32);
        assert_eq!(first, Ok(Ok(())));

        let second = client.try_initialize_with_admin_signers(&admin, &signers, &1u32);
        assert_eq!(second, Ok(Err(EscrowError::E1)));
    }

    #[test]
    fn test_initialize_with_admin_signers_rejects_invalid_threshold() {
        let (_env, admin, client) = uninitialized_client();
        let signer = Address::generate(&client.env());
        let mut signers = Vec::new(&client.env());
        signers.push_back(signer);

        let result = client.try_initialize_with_admin_signers(&admin, &signers, &0u32);
        assert_eq!(result, Ok(Err(EscrowError::E63)));
    }

    // ── Issue #218: deployment tests for missing initialization ───────────────
    //
    // Each test below calls a public entrypoint on an uninitialized contract and
    // asserts the predictable EscrowError::E2 (NotInitialized) response rather
    // than a panic or an unexpected error code.

    // Test: create_escrow fails with E2 before initialization.
    #[test]
    fn test_create_escrow_fails_before_initialization() {
        let (env, _admin, client) = uninitialized_client();
        let escrow_client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token = Address::generate(&env);
        let brief_hash = soroban_sdk::BytesN::from_array(&env, &[1u8; 32]);
        let no_multisig = MultisigConfig {
            approvers: Vec::new(&env),
            weights: Vec::new(&env),
            threshold: 0,
        };

        let result = client.try_create_escrow(
            &escrow_client,
            &freelancer,
            &token,
            &1_000_i128,
            &brief_hash,
            &None,
            &None,
            &None,
            &None,
            &no_multisig,
            &None,
        );

        assert_eq!(
            result,
            Ok(Err(EscrowError::E2)),
            "create_escrow must return E2 (NotInitialized) before initialization"
        );
    }

    // Test: pause fails with E2 before initialization.
    //
    // pause() delegates to require_admin which first calls require_initialized.
    #[test]
    fn test_pause_fails_before_initialization() {
        let (env, admin, client) = uninitialized_client();

        let result = client.try_pause(&admin);

        assert_eq!(
            result,
            Ok(Err(EscrowError::E2)),
            "pause must return E2 (NotInitialized) before initialization"
        );
    }

    // Test: set_admin_multisig (admin-only config) fails with E2 before initialization.
    #[test]
    fn test_set_admin_multisig_fails_before_initialization() {
        let (env, admin, client) = uninitialized_client();
        let signers = Vec::new(&env);

        let result = client.try_set_admin_multisig(&admin, &signers, &1u32);

        assert_eq!(
            result,
            Ok(Err(EscrowError::E2)),
            "set_admin_multisig must return E2 (NotInitialized) before initialization"
        );
    }

    // Test: get_admin fails with E2 before initialization.
    #[test]
    fn test_get_admin_fails_before_initialization() {
        let (_env, _admin, client) = uninitialized_client();

        let result = client.try_get_admin();

        assert_eq!(
            result,
            Ok(Err(EscrowError::E2)),
            "get_admin must return E2 (NotInitialized) before initialization"
        );
    }

    // Test: get_admin_signers fails with E2 before initialization.
    #[test]
    fn test_get_admin_signers_fails_before_initialization() {
        let (_env, _admin, client) = uninitialized_client();

        let result = client.try_get_admin_signers();

        assert_eq!(
            result,
            Ok(Err(EscrowError::E2)),
            "get_admin_signers must return E2 (NotInitialized) before initialization"
        );
    }

    // Test: get_admin_threshold fails with E2 before initialization.
    #[test]
    fn test_get_admin_threshold_fails_before_initialization() {
        let (_env, _admin, client) = uninitialized_client();

        let result = client.try_get_admin_threshold();

        assert_eq!(
            result,
            Ok(Err(EscrowError::E2)),
            "get_admin_threshold must return E2 (NotInitialized) before initialization"
        );
    }

    // Test: unpause fails with E2 before initialization.
    #[test]
    fn test_unpause_fails_before_initialization() {
        let (env, admin, client) = uninitialized_client();

        let result = client.try_unpause(&admin);

        assert_eq!(
            result,
            Ok(Err(EscrowError::E2)),
            "unpause must return E2 (NotInitialized) before initialization"
        );
    }

    // Test: set_high_value_threshold (admin-only config) fails with E2 before initialization.
    #[test]
    fn test_set_high_value_threshold_fails_before_initialization() {
        let (env, admin, client) = uninitialized_client();

        let result = client.try_set_high_value_threshold(&admin, &100_000_i128);

        assert_eq!(
            result,
            Ok(Err(EscrowError::E2)),
            "set_high_value_threshold must return E2 (NotInitialized) before initialization"
        );
    }

    // Test: upgrade (admin-only) fails with E2 before initialization.
    #[test]
    fn test_upgrade_fails_before_initialization() {
        let (env, admin, client) = uninitialized_client();
        // A dummy wasm hash — the call should fail at the auth/init check before
        // attempting any actual upgrade.
        let wasm_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);

        let result = client.try_upgrade(&admin, &wasm_hash);

        assert_eq!(
            result,
            Ok(Err(EscrowError::E2)),
            "upgrade must return E2 (NotInitialized) before initialization"
        );
    }

    // Test: initialize succeeds on a fresh contract and subsequent calls return E1 (AlreadyInitialized).
    //
    // This validates the happy-path baseline and ensures the duplicate-init guard works.
    #[test]
    fn test_initialize_succeeds_then_duplicate_fails() {
        let (_env, admin, client) = uninitialized_client();

        let first = client.try_initialize(&admin);
        assert_eq!(
            first,
            Ok(Ok(())),
            "first initialize call must succeed on uninitialized contract"
        );

        let second = client.try_initialize(&admin);
        assert_eq!(
            second,
            Ok(Err(EscrowError::E1)),
            "second initialize call must return E1 (AlreadyInitialized)"
        );
    }
}
