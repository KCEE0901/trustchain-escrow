//! # Deadline Auto-Cancellation — Authorization Boundaries
//!
//! `trigger_expiry` is permissionless: any keeper may cancel an expired
//! escrow, but only on its own signed authorization for that exact call.
//! These tests check that missing, incorrect and stale authorizations are
//! rejected without moving funds or changing state, that a paused contract
//! refuses even a correctly authorized keeper, and that the success path
//! asks for the keeper's authorization alone (never the client's or the
//! freelancer's).

#[cfg(test)]
mod deadline_auth_boundary_tests {
    extern crate std;

    use soroban_sdk::{
        testutils::{Address as _, AuthorizedFunction, Ledger as _, MockAuth, MockAuthInvoke},
        token, Address, BytesN, Env, IntoVal, Symbol, Val, Vec,
    };

    use crate::{EscrowContract, EscrowContractClient, EscrowError, EscrowStatus, MultisigConfig};

    const TOTAL: i128 = 500;
    const DEADLINE: u64 = 1_100;

    struct Fixture {
        env: Env,
        contract_id: Address,
        contract: EscrowContractClient<'static>,
        admin: Address,
        token_id: Address,
        client: Address,
        freelancer: Address,
        keeper: Address,
    }

    fn setup() -> Fixture {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000);
        let admin = Address::generate(&env);
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let contract_id = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &contract_id);
        contract.initialize(&admin);
        Fixture {
            client: Address::generate(&env),
            freelancer: Address::generate(&env),
            keeper: Address::generate(&env),
            env,
            contract_id,
            contract,
            admin,
            token_id,
        }
    }

    fn create(f: &Fixture, seed: u8) -> u64 {
        token::StellarAssetClient::new(&f.env, &f.token_id).mint(&f.client, &(TOTAL + 100_000));
        f.contract.create_escrow(
            &f.client,
            &f.freelancer,
            &f.token_id,
            &TOTAL,
            &BytesN::from_array(&f.env, &[seed; 32]),
            &None,
            &Some(DEADLINE),
            &None,
            &None,
            &MultisigConfig {
                approvers: Vec::new(&f.env),
                weights: Vec::new(&f.env),
                threshold: 0,
            },
            &None,
        )
    }

    fn expiry_args(f: &Fixture, caller: &Address, escrow_id: u64) -> Vec<Val> {
        (caller.clone(), escrow_id).into_val(&f.env)
    }

    /// Authorize exactly one call: `signer` signs `fn_name(args)`.
    fn authorize(f: &Fixture, signer: &Address, fn_name: &str, args: Vec<Val>) {
        f.env.mock_auths(&[MockAuth {
            address: signer,
            invoke: &MockAuthInvoke {
                contract: &f.contract_id,
                fn_name,
                args,
                sub_invokes: &[],
            },
        }]);
    }

    fn client_balance(f: &Fixture) -> i128 {
        token::Client::new(&f.env, &f.token_id).balance(&f.client)
    }

    /// The escrow is untouched: still active with its full balance, and no
    /// refund reached the client.
    fn assert_untouched(f: &Fixture, escrow_id: u64, balance_before: i128) {
        let state = f.contract.get_escrow(&escrow_id);
        assert_eq!(state.status, EscrowStatus::Active);
        assert_eq!(state.remaining_balance, TOTAL);
        assert_eq!(client_balance(f), balance_before);
        assert!(f.contract.is_expired(&escrow_id));
    }

    // ── Primary path ─────────────────────────────────────────────────────────

    #[test]
    fn keeper_with_exact_authorization_cancels() {
        let f = setup();
        let escrow_id = create(&f, 1);
        f.env.ledger().set_timestamp(DEADLINE + 1);
        let before = client_balance(&f);

        authorize(
            &f,
            &f.keeper,
            "trigger_expiry",
            expiry_args(&f, &f.keeper, escrow_id),
        );
        assert_eq!(f.contract.trigger_expiry(&f.keeper, &escrow_id), TOTAL);

        assert_eq!(
            f.contract.get_escrow(&escrow_id).status,
            EscrowStatus::Cancelled
        );
        assert_eq!(client_balance(&f), before + TOTAL);
    }

    #[test]
    fn success_path_requires_only_the_keeper() {
        let f = setup();
        let escrow_id = create(&f, 2);
        f.env.ledger().set_timestamp(DEADLINE + 1);

        f.contract.trigger_expiry(&f.keeper, &escrow_id);

        let auths = f.env.auths();
        let keeper_auths: std::vec::Vec<_> = auths.iter().filter(|(a, _)| *a == f.keeper).collect();
        assert_eq!(keeper_auths.len(), 1);
        assert_eq!(
            keeper_auths[0].1.function,
            AuthorizedFunction::Contract((
                f.contract_id.clone(),
                Symbol::new(&f.env, "trigger_expiry"),
                expiry_args(&f, &f.keeper, escrow_id),
            ))
        );
        for party in [&f.client, &f.freelancer, &f.admin] {
            assert!(
                auths.iter().all(|(a, _)| a != party),
                "auto-cancellation must not need a party's authorization"
            );
        }
    }

    // ── Missing authorization ────────────────────────────────────────────────

    #[test]
    fn missing_authorization_is_rejected() {
        let f = setup();
        let escrow_id = create(&f, 3);
        f.env.ledger().set_timestamp(DEADLINE + 1);
        let before = client_balance(&f);

        f.env.mock_auths(&[]);
        assert!(f
            .contract
            .try_trigger_expiry(&f.keeper, &escrow_id)
            .is_err());

        assert_untouched(&f, escrow_id, before);
    }

    // ── Incorrect authorization ──────────────────────────────────────────────

    #[test]
    fn authorization_from_another_address_is_rejected() {
        let f = setup();
        let escrow_id = create(&f, 4);
        f.env.ledger().set_timestamp(DEADLINE + 1);
        let before = client_balance(&f);
        let impostor = Address::generate(&f.env);

        // The impostor signs a call naming the keeper as caller.
        authorize(
            &f,
            &impostor,
            "trigger_expiry",
            expiry_args(&f, &f.keeper, escrow_id),
        );
        assert!(f
            .contract
            .try_trigger_expiry(&f.keeper, &escrow_id)
            .is_err());

        assert_untouched(&f, escrow_id, before);
    }

    #[test]
    fn authorization_for_another_function_is_rejected() {
        let f = setup();
        let escrow_id = create(&f, 5);
        f.env.ledger().set_timestamp(DEADLINE + 1);
        let before = client_balance(&f);

        authorize(
            &f,
            &f.keeper,
            "cancel_escrow",
            expiry_args(&f, &f.keeper, escrow_id),
        );
        assert!(f
            .contract
            .try_trigger_expiry(&f.keeper, &escrow_id)
            .is_err());

        assert_untouched(&f, escrow_id, before);
    }

    // ── Stale authorization ──────────────────────────────────────────────────

    #[test]
    fn authorization_for_another_escrow_is_rejected() {
        let f = setup();
        let signed_for = create(&f, 6);
        let target = create(&f, 7);
        f.env.ledger().set_timestamp(DEADLINE + 1);
        let before = client_balance(&f);

        // A signature captured for one escrow cannot cancel a different one.
        authorize(
            &f,
            &f.keeper,
            "trigger_expiry",
            expiry_args(&f, &f.keeper, signed_for),
        );
        assert!(f.contract.try_trigger_expiry(&f.keeper, &target).is_err());

        assert_untouched(&f, target, before);
        assert_untouched(&f, signed_for, before);
    }

    #[test]
    fn authorization_for_a_cancelled_escrow_cannot_cancel_again() {
        let f = setup();
        let escrow_id = create(&f, 8);
        f.env.ledger().set_timestamp(DEADLINE + 1);
        f.contract.trigger_expiry(&f.keeper, &escrow_id);
        let after_cancel = client_balance(&f);

        authorize(
            &f,
            &f.keeper,
            "trigger_expiry",
            expiry_args(&f, &f.keeper, escrow_id),
        );
        assert!(matches!(
            f.contract.try_trigger_expiry(&f.keeper, &escrow_id),
            Err(Ok(EscrowError::E9))
        ));
        assert_eq!(client_balance(&f), after_cancel);
    }

    // ── Paused contract ──────────────────────────────────────────────────────

    #[test]
    fn paused_contract_rejects_an_authorized_keeper() {
        let f = setup();
        let escrow_id = create(&f, 9);
        f.contract.pause(&f.admin);
        f.env.ledger().set_timestamp(DEADLINE + 1);
        let before = client_balance(&f);

        authorize(
            &f,
            &f.keeper,
            "trigger_expiry",
            expiry_args(&f, &f.keeper, escrow_id),
        );
        assert!(matches!(
            f.contract.try_trigger_expiry(&f.keeper, &escrow_id),
            Err(Ok(EscrowError::E31))
        ));

        f.env.mock_all_auths();
        assert_untouched(&f, escrow_id, before);
    }
}
