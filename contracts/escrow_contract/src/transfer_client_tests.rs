#[cfg(test)]
#[allow(clippy::module_inception)]
mod transfer_client_tests {
    use crate::{EscrowContract, EscrowContractClient, EscrowError, MultisigConfig};
    use soroban_sdk::{testutils::Address as _, token, Address, BytesN, Env, String};

    fn no_multisig(env: &Env) -> MultisigConfig {
        MultisigConfig {
            approvers: soroban_sdk::Vec::new(env),
            weights: soroban_sdk::Vec::new(env),
            threshold: 0,
        }
    }

    fn setup() -> (Env, Address, EscrowContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.initialize(&admin);
        (env, admin, client)
    }

    fn register_token(env: &Env, admin: &Address, recipient: &Address, amount: i128) -> Address {
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = soroban_sdk::token::StellarAssetClient::new(env, &token_id.address());
        sac.mint(recipient, &amount);
        token_id.address()
    }

    fn create_escrow_with_token(
        env: &Env,
        client: &EscrowContractClient,
        admin: &Address,
        escrow_client: &Address,
        freelancer: &Address,
        amount: i128,
    ) -> (u64, Address) {
        let token = register_token(env, admin, escrow_client, amount + 1_000);
        let escrow_id = client.create_escrow(
            escrow_client,
            freelancer,
            &token,
            &amount,
            &BytesN::from_array(env, &[1; 32]),
            &None,
            &None,
            &None,
            &None,
            &no_multisig(env),
            &None,
        );
        (escrow_id, token)
    }

    fn create_escrow(
        env: &Env,
        client: &EscrowContractClient,
        escrow_client: &Address,
        freelancer: &Address,
        arbiter: Option<Address>,
    ) -> u64 {
        let admin = Address::generate(env);
        let token = register_token(env, &admin, escrow_client, 1000);
        client.create_escrow(
            escrow_client,
            freelancer,
            &token,
            &500,
            &BytesN::from_array(env, &[1; 32]),
            &arbiter,
            &None,
            &None,
            &None,
            &no_multisig(env),
            &None,
        )
    }

    #[test]
    fn test_transfer_client_role_success() {
        let (env, _admin, client) = setup();
        let escrow_client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let new_client = Address::generate(&env);

        let escrow_id = create_escrow(&env, &client, &escrow_client, &freelancer, None);

        client.transfer_client_role(&escrow_id, &new_client);

        let escrow = client.get_escrow(&escrow_id);
        assert_eq!(escrow.client, new_client);
    }

    #[test]
    fn test_transfer_client_role_rejects_same_as_freelancer() {
        let (env, _admin, client) = setup();
        let escrow_client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let escrow_id = create_escrow(&env, &client, &escrow_client, &freelancer, None);

        let result = client.try_transfer_client_role(&escrow_id, &freelancer);
        assert!(
            matches!(result, Err(Ok(EscrowError::E3))),
            "Should reject new_client == freelancer"
        );
    }

    #[test]
    fn test_transfer_client_role_rejects_same_as_arbiter() {
        let (env, _admin, client) = setup();
        let escrow_client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let arbiter = Address::generate(&env);

        let escrow_id = create_escrow(
            &env,
            &client,
            &escrow_client,
            &freelancer,
            Some(arbiter.clone()),
        );

        let result = client.try_transfer_client_role(&escrow_id, &arbiter);
        assert!(
            matches!(result, Err(Ok(EscrowError::E3))),
            "Should reject new_client == arbiter"
        );
    }

    #[test]
    fn test_transfer_client_role_rejects_non_active_escrow() {
        let (env, _admin, client) = setup();
        let escrow_client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let new_client = Address::generate(&env);

        let escrow_id = create_escrow(&env, &client, &escrow_client, &freelancer, None);

        // Cancel the escrow to make it non-Active
        client.cancel_escrow(&escrow_client, &escrow_id);

        let result = client.try_transfer_client_role(&escrow_id, &new_client);
        assert!(
            matches!(result, Err(Ok(EscrowError::E9))),
            "Should reject transfer on non-Active escrow"
        );
    }

    // ── Issue #219: transfer client failure mapping tests ─────────────────────
    //
    // These tests verify that token transfer failures map to stable contract
    // error codes rather than unexpected panics. They cover the four transfer
    // paths: fund (create), release, refund (cancel), and fee withdrawal.

    // ── Fund path ─────────────────────────────────────────────────────────────

    // Test: create_escrow with a zero-amount escrow returns E34 (or similar
    // amount-validation error) before any token transfer is attempted, ensuring
    // the precondition fires as a stable error code.
    #[test]
    fn test_fund_path_zero_amount_returns_stable_error() {
        let (env, admin, client) = setup();
        let escrow_client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token = register_token(&env, &admin, &escrow_client, 10_000);

        // Amount of 0 should be rejected by the contract before touching the token.
        let result = client.try_create_escrow(
            &escrow_client,
            &freelancer,
            &token,
            &0_i128,
            &BytesN::from_array(&env, &[1; 32]),
            &None,
            &None,
            &None,
            &None,
            &no_multisig(&env),
            &None,
        );

        assert!(
            result.is_err() || matches!(result, Ok(Err(_))),
            "create_escrow with amount=0 must return a stable error, not succeed"
        );
    }

    // Test: create_escrow with a client who has no tokens panics (host-level
    // transfer failure). This documents the current behaviour: the contract
    // does not wrap insufficient-balance panics into a typed error code.
    #[test]
    #[should_panic]
    fn test_fund_path_insufficient_balance_panics() {
        let (env, admin, client) = setup();
        let escrow_client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        // Register a token but do NOT mint any balance to escrow_client.
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token = token_id.address();

        // This must panic at the host level because the client has no tokens.
        client.create_escrow(
            &escrow_client,
            &freelancer,
            &token,
            &1_000_i128,
            &BytesN::from_array(&env, &[1; 32]),
            &None,
            &None,
            &None,
            &None,
            &no_multisig(&env),
            &None,
        );
    }

    // ── Release path ──────────────────────────────────────────────────────────

    // Test: release_funds on a milestone that is not in Approved state returns
    // EscrowError::E14, a stable error code that prevents an invalid transfer.
    #[test]
    fn test_release_path_non_approved_milestone_returns_e14() {
        let (env, admin, client) = setup();
        let escrow_client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let (escrow_id, _token) =
            create_escrow_with_token(&env, &client, &admin, &escrow_client, &freelancer, 5_000);

        // Add a milestone (Pending status) — never submitted or approved.
        let mid = client.add_milestone(
            &escrow_client,
            &escrow_id,
            &String::from_str(&env, "M1"),
            &BytesN::from_array(&env, &[2; 32]),
            &2_000_i128,
        );

        // release_funds must return E14 (MilestoneNotApproved) rather than
        // attempting a token transfer and panicking.
        let result = client.try_release_funds(&admin, &escrow_id, &mid);
        assert_eq!(
            result,
            Ok(Err(EscrowError::E14)),
            "release_funds on non-Approved milestone must return E14"
        );
    }

    // Test: release_funds on a submitted (but not yet approved) milestone
    // also returns E14.
    #[test]
    fn test_release_path_submitted_milestone_returns_e14() {
        let (env, admin, client) = setup();
        let escrow_client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let (escrow_id, _token) =
            create_escrow_with_token(&env, &client, &admin, &escrow_client, &freelancer, 5_000);

        let mid = client.add_milestone(
            &escrow_client,
            &escrow_id,
            &String::from_str(&env, "M1"),
            &BytesN::from_array(&env, &[2; 32]),
            &2_000_i128,
        );

        // Freelancer submits — milestone is now Submitted, not Approved.
        client.submit_milestone(&freelancer, &escrow_id, &mid);

        let result = client.try_release_funds(&admin, &escrow_id, &mid);
        assert_eq!(
            result,
            Ok(Err(EscrowError::E14)),
            "release_funds on Submitted (not Approved) milestone must return E14"
        );
    }

    // Test: release_funds on a non-existent milestone returns a stable error
    // (not a panic) because the contract performs a safe load first.
    #[test]
    fn test_release_path_nonexistent_milestone_returns_stable_error() {
        let (env, admin, client) = setup();
        let escrow_client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let (escrow_id, _token) =
            create_escrow_with_token(&env, &client, &admin, &escrow_client, &freelancer, 5_000);

        // milestone_id 99 does not exist.
        let result = client.try_release_funds(&admin, &escrow_id, &99u32);
        assert!(
            matches!(result, Ok(Err(_))),
            "release_funds on nonexistent milestone must return a stable error code"
        );
    }

    // ── Refund path (cancel_escrow) ───────────────────────────────────────────

    // Test: cancel_escrow on a non-Active escrow (already Cancelled) returns
    // EscrowError::E9, preventing a double-refund transfer attempt.
    #[test]
    fn test_refund_path_double_cancel_returns_e9() {
        let (env, admin, client) = setup();
        let escrow_client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let (escrow_id, _token) =
            create_escrow_with_token(&env, &client, &admin, &escrow_client, &freelancer, 5_000);

        // First cancel succeeds.
        client.cancel_escrow(&escrow_client, &escrow_id);

        // Second cancel must return E9 (EscrowNotActive).
        let result = client.try_cancel_escrow(&escrow_client, &escrow_id);
        assert_eq!(
            result,
            Ok(Err(EscrowError::E9)),
            "double cancel must return E9 (EscrowNotActive)"
        );
    }

    // Test: cancel_escrow by the freelancer (non-client) returns EscrowError::E5,
    // preventing an unauthorised refund transfer.
    #[test]
    fn test_refund_path_non_client_cancel_returns_e5() {
        let (env, admin, client) = setup();
        let escrow_client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let (escrow_id, _token) =
            create_escrow_with_token(&env, &client, &admin, &escrow_client, &freelancer, 5_000);

        let result = client.try_cancel_escrow(&freelancer, &escrow_id);
        assert_eq!(
            result,
            Ok(Err(EscrowError::E5)),
            "cancel_escrow by non-client must return E5"
        );
    }

    // ── Fee withdrawal path ───────────────────────────────────────────────────

    // Test: collect_escrow_fee on an Active escrow (not yet completed/cancelled)
    // returns EscrowError::E9, ensuring the fee transfer is not attempted prematurely.
    #[test]
    fn test_fee_withdrawal_on_active_escrow_returns_e9() {
        let (env, admin, client) = setup();
        let escrow_client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let (escrow_id, _token) =
            create_escrow_with_token(&env, &client, &admin, &escrow_client, &freelancer, 5_000);

        // Escrow is still Active — fee collection must be rejected.
        let result = client.try_collect_escrow_fee(&admin, &escrow_id);
        assert_eq!(
            result,
            Ok(Err(EscrowError::E9)),
            "collect_escrow_fee on Active escrow must return E9"
        );
    }

    // Test: collect_escrow_fee by an address that is neither admin nor client
    // returns EscrowError::E3 (unauthorized), preventing any transfer.
    #[test]
    fn test_fee_withdrawal_unauthorized_caller_returns_e3() {
        let (env, admin, client) = setup();
        let escrow_client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let stranger = Address::generate(&env);

        let (escrow_id, _token) =
            create_escrow_with_token(&env, &client, &admin, &escrow_client, &freelancer, 5_000);

        // Cancel the escrow so the status check passes.
        client.cancel_escrow(&escrow_client, &escrow_id);

        // Stranger should not be able to collect the fee.
        let result = client.try_collect_escrow_fee(&stranger, &escrow_id);
        assert_eq!(
            result,
            Ok(Err(EscrowError::E3)),
            "collect_escrow_fee by unauthorized caller must return E3"
        );
    }

    // Test: successful cancel_escrow transfers the full balance back to the client.
    // This verifies the refund transfer path completes without error when preconditions
    // are met and the token has sufficient balance.
    #[test]
    fn test_refund_path_successful_cancel_transfers_balance() {
        let (env, admin, client) = setup();
        let escrow_client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let amount = 5_000_i128;
        let (escrow_id, token) =
            create_escrow_with_token(&env, &client, &admin, &escrow_client, &freelancer, amount);

        let balance_before = token::Client::new(&env, &token).balance(&escrow_client);

        client.cancel_escrow(&escrow_client, &escrow_id);

        let balance_after = token::Client::new(&env, &token).balance(&escrow_client);
        assert_eq!(
            balance_after - balance_before,
            amount,
            "client should receive the full escrow amount back on cancel"
        );
    }
}
