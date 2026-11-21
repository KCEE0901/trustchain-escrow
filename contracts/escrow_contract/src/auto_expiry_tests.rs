//! # Auto-expiry boundary tests
//!
//! Issue #206: extend auto_expiry contract tests around exact deadline
//! timestamps to prevent off-by-one expiry behaviour.
//!
//! Scenarios covered:
//!  1. `now < deadline`  — must NOT expire (returns EscrowError::E3)
//!  2. `now == deadline` — must NOT expire (deadline has not *passed* yet)
//!  3. `now > deadline`  — MUST expire and refund client
//!  4. Already-completed escrow — must NOT expire (returns EscrowError::E9)
//!
//! The implementation in `auto_expiry.rs` uses `now <= deadline` as the
//! "not yet expired" condition, so `now == deadline` is the critical
//! boundary that confirms off-by-one correctness.

#[cfg(test)]
#[allow(clippy::module_inception)]
mod auto_expiry_tests {
    use soroban_sdk::{
        testutils::{Address as _, Ledger, LedgerInfo},
        token, Address, BytesN, Env,
    };

    use crate::{EscrowContract, EscrowContractClient, EscrowError, MultisigConfig};

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    fn no_multisig(env: &Env) -> MultisigConfig {
        MultisigConfig {
            approvers: soroban_sdk::Vec::new(env),
            weights: soroban_sdk::Vec::new(env),
            threshold: 0,
        }
    }

    fn setup() -> (Env, Address, Address, EscrowContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.initialize(&admin);
        (env, admin, contract_id, client)
    }

    fn register_token(env: &Env, admin: &Address, recipient: &Address, amount: i128) -> Address {
        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        token::StellarAssetClient::new(env, &sac.address()).mint(recipient, &(amount + 1_000));
        sac.address()
    }

    fn brief_hash(env: &Env) -> BytesN<32> {
        BytesN::from_array(env, &[7u8; 32])
    }

    /// Set the ledger timestamp to `ts`.
    fn set_time(env: &Env, ts: u64) {
        env.ledger().set(LedgerInfo {
            timestamp: ts,
            protocol_version: 22,
            sequence_number: env.ledger().sequence(),
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 10,
            min_persistent_entry_ttl: 10,
            max_entry_ttl: 3_110_400,
        });
    }

    /// Create an escrow with a specific deadline and return its ID.
    fn create_escrow_with_deadline(
        env: &Env,
        client: &EscrowContractClient,
        depositor: &Address,
        contractor: &Address,
        token: &Address,
        amount: i128,
        deadline: u64,
    ) -> u64 {
        client.create_escrow(
            depositor,
            contractor,
            token,
            &amount,
            &brief_hash(env),
            &None::<Address>,
            &Some(deadline),  // deadline
            &None::<u64>,     // lock_time
            &None,
            &no_multisig(env),
            &None,
        )
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Boundary tests
    // ─────────────────────────────────────────────────────────────────────────

    /// `now < deadline` — escrow must NOT be triggerable yet.
    #[test]
    fn test_expiry_before_deadline_is_rejected() {
        let (env, admin, _, client) = setup();
        let depositor = Address::generate(&env);
        let contractor = Address::generate(&env);
        let token = register_token(&env, &admin, &depositor, 10_000);

        let deadline: u64 = 1_000_000;
        // Set current time well before the deadline
        set_time(&env, deadline - 1);

        let escrow_id =
            create_escrow_with_deadline(&env, &client, &depositor, &contractor, &token, 500, deadline);

        // trigger_expiry must fail — deadline has not been crossed
        let result = client.try_trigger_expiry(&depositor, &escrow_id);
        assert!(
            result.is_err(),
            "trigger_expiry should be rejected before the deadline"
        );
        // The error should be E3 (invalid operation / not yet expired)
        assert_eq!(
            result.err().unwrap(),
            Ok(EscrowError::E3),
            "expected EscrowError::E3 when deadline has not passed"
        );
    }

    /// `now == deadline` — the escrow is exactly at the deadline boundary.
    ///
    /// The contract uses `now <= deadline` to detect "not yet expired", so
    /// `now == deadline` must still be rejected.
    #[test]
    fn test_expiry_exactly_at_deadline_is_rejected() {
        let (env, admin, _, client) = setup();
        let depositor = Address::generate(&env);
        let contractor = Address::generate(&env);
        let token = register_token(&env, &admin, &depositor, 10_000);

        let deadline: u64 = 2_000_000;
        // Set current time to exactly the deadline
        set_time(&env, deadline);

        let escrow_id =
            create_escrow_with_deadline(&env, &client, &depositor, &contractor, &token, 500, deadline);

        // trigger_expiry must fail at `now == deadline` (off-by-one boundary)
        let result = client.try_trigger_expiry(&depositor, &escrow_id);
        assert!(
            result.is_err(),
            "trigger_expiry should be rejected when now == deadline (boundary)"
        );
        assert_eq!(
            result.err().unwrap(),
            Ok(EscrowError::E3),
            "expected EscrowError::E3 at exact deadline boundary"
        );
    }

    /// `now > deadline` — expiry MUST succeed and refund the client.
    #[test]
    fn test_expiry_after_deadline_succeeds() {
        let (env, admin, _, client) = setup();
        let depositor = Address::generate(&env);
        let contractor = Address::generate(&env);
        let amount: i128 = 500;
        let token = register_token(&env, &admin, &depositor, 10_000);

        let deadline: u64 = 3_000_000;
        // Create the escrow while time is still before the deadline
        set_time(&env, deadline - 1);
        let escrow_id =
            create_escrow_with_deadline(&env, &client, &depositor, &contractor, &token, amount, deadline);

        // Advance time past the deadline
        set_time(&env, deadline + 1);

        // trigger_expiry must succeed
        let refunded = client.trigger_expiry(&depositor, &escrow_id);
        assert_eq!(
            refunded, amount,
            "refunded amount should equal the locked amount"
        );

        // Escrow should now be in a terminal state (Cancelled)
        let meta = client.get_escrow_meta(&escrow_id);
        // remaining_balance is 0 after a successful expiry
        assert_eq!(meta.remaining_balance, 0, "remaining_balance should be 0 after expiry");
    }

    /// Calling `trigger_expiry` on an already-completed escrow must return E9.
    #[test]
    fn test_expiry_on_completed_escrow_is_rejected() {
        let (env, admin, _, client) = setup();
        let depositor = Address::generate(&env);
        let contractor = Address::generate(&env);
        let token = register_token(&env, &admin, &depositor, 10_000);
        let amount: i128 = 300;

        let deadline: u64 = 5_000_000;
        // Create and immediately expire the escrow
        set_time(&env, deadline - 1);
        let escrow_id =
            create_escrow_with_deadline(&env, &client, &depositor, &contractor, &token, amount, deadline);

        set_time(&env, deadline + 1);
        client.trigger_expiry(&depositor, &escrow_id);

        // Attempt to expire again — must fail with E9 (wrong state)
        let result = client.try_trigger_expiry(&depositor, &escrow_id);
        assert!(
            result.is_err(),
            "trigger_expiry should be rejected on an already-expired escrow"
        );
        assert_eq!(
            result.err().unwrap(),
            Ok(EscrowError::E9),
            "expected EscrowError::E9 for already-terminal escrow"
        );
    }

    /// Escrow without a deadline must not be expirable.
    ///
    /// `trigger_expiry` should return `EscrowError::E3` when `deadline` is `None`.
    #[test]
    fn test_expiry_without_deadline_is_rejected() {
        let (env, admin, _, client) = setup();
        let depositor = Address::generate(&env);
        let contractor = Address::generate(&env);
        let token = register_token(&env, &admin, &depositor, 10_000);

        set_time(&env, 1_000_000);

        // Create escrow with NO deadline
        let escrow_id = client.create_escrow(
            &depositor,
            &contractor,
            &token,
            &400,
            &brief_hash(&env),
            &None::<Address>,
            &None::<u64>, // no deadline
            &None::<u64>,
            &None,
            &no_multisig(&env),
            &None,
        );

        let result = client.try_trigger_expiry(&depositor, &escrow_id);
        assert!(
            result.is_err(),
            "trigger_expiry should be rejected when no deadline is set"
        );
        assert_eq!(
            result.err().unwrap(),
            Ok(EscrowError::E3),
            "expected EscrowError::E3 for escrow with no deadline"
        );
    }

    /// Regression: `now` that is 1 second past the deadline must trigger expiry.
    ///
    /// Validates that the boundary at `deadline + 1` is the first valid
    /// trigger timestamp (not `deadline + 2` or later).
    #[test]
    fn test_expiry_one_second_after_deadline_succeeds() {
        let (env, admin, _, client) = setup();
        let depositor = Address::generate(&env);
        let contractor = Address::generate(&env);
        let amount: i128 = 200;
        let token = register_token(&env, &admin, &depositor, 10_000);

        let deadline: u64 = 4_000_000;
        set_time(&env, deadline - 1);
        let escrow_id =
            create_escrow_with_deadline(&env, &client, &depositor, &contractor, &token, amount, deadline);

        // Exactly one second past the deadline — must succeed
        set_time(&env, deadline + 1);
        let refunded = client.trigger_expiry(&depositor, &escrow_id);
        assert_eq!(refunded, amount, "should refund full amount one second past deadline");
    }
}
