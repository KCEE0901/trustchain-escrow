#[cfg(test)]
mod wrapped_token_registry_invariant_tests {
    use crate::{
        EscrowContract, EscrowContractClient, EscrowError,
    };
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token, Address, BytesN, Env, Vec,
    };

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    fn setup() -> (Env, EscrowContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        (env, client, admin)
    }

    fn register_token(env: &Env, client: &EscrowContractClient, admin: &Address) -> Address {
        let token_admin = Address::generate(env);
        let token_id = env.register_stellar_asset_contract(token_admin);
        client.add_approved_token(admin, &token_id);
        token_id
    }

    fn no_multisig() -> Vec<Address> {
        Vec::new(&Env::default())
    }

    fn brief_hash(env: &Env, seed: u8) -> BytesN<32> {
        BytesN::from_array(env, &[seed; 32])
    }

    // ---------------------------------------------------------------------
    // Success path: registered wrapped token is accepted
    // ---------------------------------------------------------------------

    #[test]
    fn registered_wrapped_token_is_accepted() {
        let (env, client, admin) = setup();
        let token_id = register_token(&env, &client, &admin);

        assert!(client.is_approved_token(&token_id));

        let depositor = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let amount: i128 = 1_000;

        let token_admin_client = token::StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&depositor, &amount);

        let brief = brief_hash(&env, 1);
        let escrow_id = client.create_escrow(
            &depositor,
            &freelancer,
            &token_id,
            &amount,
            &brief,
            &no_multisig(),
        );

        assert_eq!(client.get_escrow(&escrow_id).token, token_id);
    }

    // ---------------------------------------------------------------------
    // Rejection: unregistered token is refused with E3 and no state mutation
    // ---------------------------------------------------------------------

    #[test]
    fn unregistered_wrapped_token_is_rejected_without_state_mutation() {
        let (env, client, _admin) = setup();

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(token_admin);

        assert!(!client.is_approved_token(&token_id));

        let depositor = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let amount: i128 = 500;

        let token_admin_client = token::StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&depositor, &amount);

        let brief = brief_hash(&env, 2);
        let result = client.try_create_escrow(
            &depositor,
            &freelancer,
            &token_id,
            &amount,
            &brief,
            &no_multisig(),
        );

        assert_eq!(result, Err(Ok(EscrowError::E3)));

        // No escrow should have been persisted.
        assert_eq!(client.get_escrow_count(), 0);
    }

    // ---------------------------------------------------------------------
    // Rejection after removal: previously approved token is refused
    // ---------------------------------------------------------------------

    #[test]
    fn removed_wrapped_token_is_rejected() {
        let (env, client, admin) = setup();
        let token_id = register_token(&env, &client, &admin);

        assert!(client.is_approved_token(&token_id));

        client.remove_approved_token(&admin, &token_id);
        assert!(!client.is_approved_token(&token_id));

        let depositor = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let amount: i128 = 750;

        let token_admin_client = token::StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&depositor, &amount);

        let brief = brief_hash(&env, 3);
        let result = client.try_create_escrow(
            &depositor,
            &freelancer,
            &token_id,
            &amount,
            &brief,
            &no_multisig(),
        );

        assert_eq!(result, Err(Ok(EscrowError::E3)));
        assert_eq!(client.get_escrow_count(), 0);
    }

    // ---------------------------------------------------------------------
    // Boundary: empty registry rejects every token
    // ---------------------------------------------------------------------

    #[test]
    fn empty_registry_rejects_all_tokens() {
        let (env, client, _admin) = setup();

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(token_admin);

        assert!(!client.is_approved_token(&token_id));

        let depositor = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let amount: i128 = 100;

        let token_admin_client = token::StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&depositor, &amount);

        let brief = brief_hash(&env, 4);
        let result = client.try_create_escrow(
            &depositor,
            &freelancer,
            &token_id,
            &amount,
            &brief,
            &no_multisig(),
        );

        assert_eq!(result, Err(Ok(EscrowError::E3)));
        assert_eq!(client.get_escrow_count(), 0);
    }

    // ---------------------------------------------------------------------
    // Boundary: duplicate add_approved_token is idempotent
    // ---------------------------------------------------------------------

    #[test]
    fn duplicate_add_approved_token_is_idempotent() {
        let (env, client, admin) = setup();

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(token_admin);

        client.add_approved_token(&admin, &token_id);
        assert!(client.is_approved_token(&token_id));

        // Adding the same token again must not error and must remain approved.
        client.add_approved_token(&admin, &token_id);
        assert!(client.is_approved_token(&token_id));

        // The registry should still accept the token on the success path.
        let depositor = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let amount: i128 = 250;

        let token_admin_client = token::StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&depositor, &amount);

        let brief = brief_hash(&env, 5);
        let escrow_id = client.create_escrow(
            &depositor,
            &freelancer,
            &token_id,
            &amount,
            &brief,
            &no_multisig(),
        );

        assert_eq!(client.get_escrow(&escrow_id).token, token_id);
    }
}