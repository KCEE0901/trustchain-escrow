//! Authorization boundary tests for the arbiter selection lifecycle
//! (Issue #507): selecting an arbiter (`create_escrow`, `update_arbiter`),
//! the arbiter acting (`resolve_dispute`) and revocation (allowlist removal),
//! each checked against missing, stale and incorrect authorization.

#[cfg(test)]
#[allow(clippy::module_inception)]
mod arbiter_lifecycle_auth_tests {
    use soroban_sdk::{
        testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke},
        token, Address, BytesN, Env, IntoVal,
    };

    use crate::{
        EscrowContract, EscrowContractClient, EscrowError, EscrowStatus, MultisigConfig,
        DISPUTE_COOLDOWN_LEDGERS,
    };

    const AMOUNT: i128 = 1_000;

    struct Fixture {
        env: Env,
        contract_id: Address,
        client: EscrowContractClient<'static>,
        admin: Address,
        depositor: Address,
        freelancer: Address,
        token: Address,
        arbiter: Address,
    }

    fn no_multisig(env: &Env) -> MultisigConfig {
        MultisigConfig {
            approvers: soroban_sdk::Vec::new(env),
            weights: soroban_sdk::Vec::new(env),
            threshold: 0,
        }
    }

    fn setup() -> Fixture {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.initialize(&admin);

        let depositor = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let arbiter = Address::generate(&env);
        client.add_to_arbiter_allowlist(&admin, &arbiter);

        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        token::StellarAssetClient::new(&env, &sac.address())
            .mint(&depositor, &(AMOUNT * 4 + 1_000));

        Fixture {
            env,
            contract_id,
            client,
            admin,
            depositor,
            freelancer,
            token: sac.address(),
            arbiter,
        }
    }

    fn create(f: &Fixture, arbiter: Option<Address>) -> u64 {
        f.client.create_escrow(
            &f.depositor,
            &f.freelancer,
            &f.token,
            &AMOUNT,
            &BytesN::from_array(&f.env, &[9; 32]),
            &arbiter,
            &None,
            &None,
            &None,
            &no_multisig(&f.env),
            &None,
        )
    }

    fn allowlisted(f: &Fixture) -> Address {
        let a = Address::generate(&f.env);
        f.client.add_to_arbiter_allowlist(&f.admin, &a);
        a
    }

    /// Replace mocked auth with signatures from `signers` only, each covering
    /// exactly one `update_arbiter(escrow_id, new_arbiter)` call.
    fn sign_update(
        f: &Fixture,
        signers: &[&Address],
        escrow_id: u64,
        new_arbiter: &Option<Address>,
    ) {
        let args: soroban_sdk::Vec<soroban_sdk::Val> =
            (escrow_id, new_arbiter.clone()).into_val(&f.env);
        let invoke = MockAuthInvoke {
            contract: &f.contract_id,
            fn_name: "update_arbiter",
            args,
            sub_invokes: &[],
        };
        match signers {
            [] => f.env.mock_auths(&[]),
            [a] => f.env.mock_auths(&[MockAuth {
                address: *a,
                invoke: &invoke,
            }]),
            [a, b] => f.env.mock_auths(&[
                MockAuth {
                    address: *a,
                    invoke: &invoke,
                },
                MockAuth {
                    address: *b,
                    invoke: &invoke,
                },
            ]),
            _ => panic!("at most two signers"),
        }
    }

    fn dispute_ready(f: &Fixture, escrow_id: u64) {
        f.client.raise_dispute(&f.depositor, &escrow_id, &None);
        f.env
            .ledger()
            .with_mut(|l| l.sequence_number += DISPUTE_COOLDOWN_LEDGERS + 1);
    }

    // ── Select: primary success path ─────────────────────────────────────────

    #[test]
    fn both_parties_can_switch_to_another_allowlisted_arbiter() {
        let f = setup();
        let escrow_id = create(&f, Some(f.arbiter.clone()));
        let replacement = Some(allowlisted(&f));

        sign_update(&f, &[&f.depositor, &f.freelancer], escrow_id, &replacement);
        f.client.update_arbiter(&escrow_id, &replacement);

        assert_eq!(f.client.get_escrow(&escrow_id).arbiter, replacement);
    }

    #[test]
    fn both_parties_can_remove_the_arbiter() {
        let f = setup();
        let escrow_id = create(&f, Some(f.arbiter.clone()));

        sign_update(&f, &[&f.depositor, &f.freelancer], escrow_id, &None);
        f.client.update_arbiter(&escrow_id, &None);

        assert_eq!(f.client.get_escrow(&escrow_id).arbiter, None);
    }

    // ── Select: missing authorization ────────────────────────────────────────

    #[test]
    fn update_without_both_signatures_is_rejected() {
        let f = setup();
        let escrow_id = create(&f, Some(f.arbiter.clone()));
        let replacement = Some(allowlisted(&f));

        for signers in [&[][..], &[&f.depositor][..], &[&f.freelancer][..]] {
            sign_update(&f, signers, escrow_id, &replacement);
            assert!(f
                .client
                .try_update_arbiter(&escrow_id, &replacement)
                .is_err());
        }
        assert_eq!(
            f.client.get_escrow(&escrow_id).arbiter,
            Some(f.arbiter.clone())
        );
    }

    #[test]
    fn signatures_for_a_different_arbiter_are_rejected() {
        let f = setup();
        let escrow_id = create(&f, Some(f.arbiter.clone()));
        let agreed = Some(allowlisted(&f));
        let swapped = Some(allowlisted(&f));

        sign_update(&f, &[&f.depositor, &f.freelancer], escrow_id, &agreed);
        assert!(f.client.try_update_arbiter(&escrow_id, &swapped).is_err());
        assert_eq!(
            f.client.get_escrow(&escrow_id).arbiter,
            Some(f.arbiter.clone())
        );
    }

    // ── Select: incorrect choices ────────────────────────────────────────────

    #[test]
    fn update_cannot_bypass_the_allowlist() {
        // Previously `update_arbiter` skipped the allowlist that
        // `create_escrow` enforces.
        let f = setup();
        let escrow_id = create(&f, Some(f.arbiter.clone()));
        let outsider = Some(Address::generate(&f.env));

        assert_eq!(
            f.client.try_update_arbiter(&escrow_id, &outsider),
            Err(Ok(EscrowError::E90))
        );
        assert_eq!(
            f.client.get_escrow(&escrow_id).arbiter,
            Some(f.arbiter.clone())
        );
    }

    #[test]
    fn update_cannot_bypass_the_reputation_floor() {
        let f = setup();
        let escrow_id = create(&f, Some(f.arbiter.clone()));
        let weak = allowlisted(&f);
        f.client.update_reputation(&weak, &true, &false, &0_i128); // score 10
        f.client.set_min_arbiter_reputation(&f.admin, &50);

        assert_eq!(
            f.client.try_update_arbiter(&escrow_id, &Some(weak)),
            Err(Ok(EscrowError::E3))
        );
    }

    #[test]
    fn a_party_cannot_become_the_arbiter() {
        let f = setup();
        let escrow_id = create(&f, Some(f.arbiter.clone()));
        f.client.add_to_arbiter_allowlist(&f.admin, &f.freelancer);

        assert_eq!(
            f.client
                .try_update_arbiter(&escrow_id, &Some(f.freelancer.clone())),
            Err(Ok(EscrowError::E3))
        );
    }

    #[test]
    fn arbiter_cannot_change_once_the_escrow_is_not_active() {
        let f = setup();
        let escrow_id = create(&f, Some(f.arbiter.clone()));
        let replacement = Some(allowlisted(&f));
        f.client.raise_dispute(&f.depositor, &escrow_id, &None);

        assert_eq!(
            f.client.try_update_arbiter(&escrow_id, &replacement),
            Err(Ok(EscrowError::E9))
        );
    }

    // ── Act / revoke: stale authorization ────────────────────────────────────

    #[test]
    fn a_replaced_arbiter_can_no_longer_resolve_disputes() {
        let f = setup();
        let escrow_id = create(&f, Some(f.arbiter.clone()));
        let replacement = allowlisted(&f);
        f.client
            .update_arbiter(&escrow_id, &Some(replacement.clone()));
        dispute_ready(&f, escrow_id);

        assert_eq!(
            f.client
                .try_resolve_dispute(&f.arbiter, &escrow_id, &400, &600),
            Err(Ok(EscrowError::E4))
        );
        assert_eq!(
            f.client.get_escrow(&escrow_id).status,
            EscrowStatus::Disputed
        );

        f.client
            .resolve_dispute(&replacement, &escrow_id, &400, &600);
        assert_ne!(
            f.client.get_escrow(&escrow_id).status,
            EscrowStatus::Disputed
        );
    }

    #[test]
    fn a_revoked_arbiter_can_neither_resolve_nor_be_selected_again() {
        let f = setup();
        let escrow_id = create(&f, Some(f.arbiter.clone()));
        dispute_ready(&f, escrow_id);
        f.client.remove_from_arbiter_allowlist(&f.admin, &f.arbiter);

        assert_eq!(
            f.client
                .try_resolve_dispute(&f.arbiter, &escrow_id, &400, &600),
            Err(Ok(EscrowError::E90))
        );

        let fresh = create(&f, None);
        assert_eq!(
            f.client
                .try_update_arbiter(&fresh, &Some(f.arbiter.clone())),
            Err(Ok(EscrowError::E90))
        );
    }

    #[test]
    fn allowlist_management_rejects_non_admins_and_former_admins() {
        let f = setup();
        let stranger = Address::generate(&f.env);
        let candidate = Address::generate(&f.env);

        assert_eq!(
            f.client.try_add_to_arbiter_allowlist(&stranger, &candidate),
            Err(Ok(EscrowError::E4))
        );
        assert_eq!(
            f.client
                .try_add_to_arbiter_allowlist(&f.arbiter, &candidate),
            Err(Ok(EscrowError::E4))
        );

        let new_admin = Address::generate(&f.env);
        f.client.propose_admin(&f.admin, &new_admin);
        f.client.accept_admin(&new_admin);

        assert_eq!(
            f.client.try_add_to_arbiter_allowlist(&f.admin, &candidate),
            Err(Ok(EscrowError::E4))
        );
        assert_eq!(
            f.client
                .try_remove_from_arbiter_allowlist(&f.admin, &f.arbiter),
            Err(Ok(EscrowError::E4))
        );
        assert!(!f.client.is_arbiter_allowed(&candidate));
        assert!(f.client.is_arbiter_allowed(&f.arbiter));

        f.client.add_to_arbiter_allowlist(&new_admin, &candidate);
        assert!(f.client.is_arbiter_allowed(&candidate));
    }
}
