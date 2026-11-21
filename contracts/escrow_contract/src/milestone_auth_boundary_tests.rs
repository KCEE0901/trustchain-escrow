//! # Milestone Lookup Scalability — Authorization Boundary Tests
//!
//! Every privileged path that changes how many milestones an escrow holds or
//! what they contain must accept the authorized caller and reject:
//! - a missing signature,
//! - a stale authority (a former admin, or a client of an escrow that is no
//!   longer active),
//! - an incorrect caller.
//!
//! Lookups stay public: they require no authorization at all.
//! Every rejection is checked to leave storage unchanged.

#[cfg(test)]
#[allow(clippy::module_inception)]
mod milestone_auth_boundary_tests {
    use soroban_sdk::{testutils::Address as _, token, Address, BytesN, Env, String};

    use crate::types::DataKey;
    use crate::{
        EscrowContract, EscrowContractClient, EscrowError, MultisigConfig, PackedDataKey,
        MAX_MILESTONES,
    };

    struct Setup {
        env: Env,
        contract_id: Address,
        client: EscrowContractClient<'static>,
        admin: Address,
        buyer: Address,
        freelancer: Address,
        escrow_id: u64,
    }

    fn setup() -> Setup {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.initialize(&admin);

        let buyer = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        token::StellarAssetClient::new(&env, &token_id).mint(&buyer, &100_000);
        let escrow_id = client.create_escrow(
            &buyer,
            &freelancer,
            &token_id,
            &10_000_i128,
            &BytesN::from_array(&env, &[4; 32]),
            &None,
            &None,
            &None,
            &None,
            &MultisigConfig {
                approvers: soroban_sdk::Vec::new(&env),
                weights: soroban_sdk::Vec::new(&env),
                threshold: 0,
            },
            &None,
        );
        Setup {
            env,
            contract_id,
            client,
            admin,
            buyer,
            freelancer,
            escrow_id,
        }
    }

    fn title(s: &Setup, text: &str) -> String {
        String::from_str(&s.env, text)
    }

    fn hash(s: &Setup) -> BytesN<32> {
        BytesN::from_array(&s.env, &[8; 32])
    }

    fn try_add(s: &Setup, caller: &Address) -> Result<u32, EscrowError> {
        match s
            .client
            .try_add_milestone(caller, &s.escrow_id, &title(s, "m"), &hash(s), &100)
        {
            Ok(Ok(id)) => Ok(id),
            Err(Ok(e)) => Err(e),
            other => panic!("unexpected host result: {:?}", other),
        }
    }

    fn milestone_stored(s: &Setup, milestone_id: u32) -> bool {
        s.env.as_contract(&s.contract_id, || {
            s.env
                .storage()
                .persistent()
                .has(&PackedDataKey::Milestone(s.escrow_id, milestone_id))
        })
    }

    fn stored_cap(s: &Setup) -> Option<u32> {
        s.env.as_contract(&s.contract_id, || {
            s.env.storage().instance().get(&DataKey::MaxMilestones)
        })
    }

    fn one_item_batch(
        s: &Setup,
    ) -> (
        soroban_sdk::Vec<String>,
        soroban_sdk::Vec<BytesN<32>>,
        soroban_sdk::Vec<i128>,
    ) {
        (
            soroban_sdk::vec![&s.env, title(s, "b")],
            soroban_sdk::vec![&s.env, hash(s)],
            soroban_sdk::vec![&s.env, 100_i128],
        )
    }

    // ── Primary path ─────────────────────────────────────────────────────────

    #[test]
    fn test_client_adds_milestone_with_only_its_own_auth() {
        let s = setup();
        let id = try_add(&s, &s.buyer).expect("client may add milestones");

        let auths = s.env.auths();
        assert_eq!(auths.len(), 1);
        assert_eq!(auths[0].0, s.buyer);
        assert!(milestone_stored(&s, id));
    }

    #[test]
    fn test_admin_sets_cap_with_only_its_own_auth() {
        let s = setup();
        s.client.set_max_milestones(&s.admin, &5);

        assert_eq!(s.env.auths()[0].0, s.admin);
        assert_eq!(stored_cap(&s), Some(5));
    }

    #[test]
    fn test_lookups_require_no_authorization() {
        let s = setup();
        let id = try_add(&s, &s.buyer).unwrap();

        // Forget the mocks: lookups must still work for anyone.
        s.env.mock_auths(&[]);
        assert_eq!(s.client.get_milestone(&s.escrow_id, &id).id, id);
        assert!(s.env.auths().is_empty());
        assert_eq!(s.client.get_milestone_by_index(&s.escrow_id, &0).id, id);
        assert!(s
            .client
            .get_milestone_approvals(&s.escrow_id, &id)
            .is_empty());
        assert_eq!(s.client.get_pending_milestones_count(&s.escrow_id), 1);
        assert!(s.env.auths().is_empty());
    }

    // ── Missing authorization ────────────────────────────────────────────────

    #[test]
    fn test_add_and_batch_without_signature_are_rejected() {
        let s = setup();
        s.env.mock_auths(&[]);

        let add =
            s.client
                .try_add_milestone(&s.buyer, &s.escrow_id, &title(&s, "m"), &hash(&s), &100);
        assert!(add.is_err());

        let (titles, hashes, amounts) = one_item_batch(&s);
        let batch =
            s.client
                .try_batch_add_milestones(&s.buyer, &s.escrow_id, &titles, &hashes, &amounts);
        assert!(batch.is_err());

        assert!(!milestone_stored(&s, 0));
    }

    #[test]
    fn test_cap_and_title_changes_without_signature_are_rejected() {
        let s = setup();
        let id = try_add(&s, &s.buyer).unwrap();
        s.env.mock_auths(&[]);

        assert!(s.client.try_set_max_milestones(&s.admin, &5).is_err());
        assert_eq!(stored_cap(&s), None);

        let rename =
            s.client
                .try_update_milestone_title(&s.buyer, &s.escrow_id, &id, &title(&s, "renamed"));
        assert!(rename.is_err());
        assert_eq!(
            s.client.get_milestone(&s.escrow_id, &id).title,
            title(&s, "m")
        );
    }

    // ── Stale authorization ──────────────────────────────────────────────────

    #[test]
    fn test_former_admin_cannot_change_cap() {
        let s = setup();
        let new_admin = Address::generate(&s.env);
        s.client.propose_admin(&s.admin, &new_admin);

        // Still pending: the proposed admin has no authority yet.
        assert_eq!(
            s.client.try_set_max_milestones(&new_admin, &5),
            Err(Ok(EscrowError::E4))
        );

        s.client.accept_admin(&new_admin);
        assert_eq!(
            s.client.try_set_max_milestones(&s.admin, &5),
            Err(Ok(EscrowError::E4))
        );
        assert_eq!(stored_cap(&s), None);

        s.client.set_max_milestones(&new_admin, &5);
        assert_eq!(stored_cap(&s), Some(5));
    }

    #[test]
    fn test_client_of_cancelled_escrow_cannot_add() {
        let s = setup();
        s.client.cancel_escrow(&s.buyer, &s.escrow_id);

        let result = try_add(&s, &s.buyer);
        assert!(
            matches!(result, Err(EscrowError::E8) | Err(EscrowError::E9)),
            "got {:?}",
            result
        );
        assert!(!milestone_stored(&s, 0));
    }

    #[test]
    fn test_lowered_cap_applies_to_existing_client() {
        let s = setup();
        try_add(&s, &s.buyer).unwrap();
        try_add(&s, &s.buyer).unwrap();
        s.client.set_max_milestones(&s.admin, &2);

        assert_eq!(try_add(&s, &s.buyer), Err(EscrowError::E16));
        assert!(!milestone_stored(&s, 2));
    }

    // ── Incorrect authorization ──────────────────────────────────────────────

    #[test]
    fn test_non_client_cannot_add_or_batch() {
        let s = setup();
        let outsider = Address::generate(&s.env);

        for caller in [s.freelancer.clone(), s.admin.clone(), outsider] {
            assert_eq!(try_add(&s, &caller), Err(EscrowError::E5));

            let (titles, hashes, amounts) = one_item_batch(&s);
            assert_eq!(
                s.client.try_batch_add_milestones(
                    &caller,
                    &s.escrow_id,
                    &titles,
                    &hashes,
                    &amounts
                ),
                Err(Ok(EscrowError::E5))
            );
        }
        assert!(!milestone_stored(&s, 0));
    }

    #[test]
    fn test_non_client_cannot_rename_milestone() {
        let s = setup();
        let id = try_add(&s, &s.buyer).unwrap();

        let result = s.client.try_update_milestone_title(
            &s.freelancer,
            &s.escrow_id,
            &id,
            &title(&s, "hijacked"),
        );
        assert_eq!(result, Err(Ok(EscrowError::E5)));
        assert_eq!(
            s.client.get_milestone(&s.escrow_id, &id).title,
            title(&s, "m")
        );
    }

    #[test]
    fn test_non_admin_cannot_change_cap() {
        let s = setup();
        for caller in [s.buyer.clone(), s.freelancer.clone()] {
            assert_eq!(
                s.client
                    .try_set_max_milestones(&caller, &(MAX_MILESTONES + 1)),
                Err(Ok(EscrowError::E4))
            );
        }
        assert_eq!(stored_cap(&s), None);
    }
}
