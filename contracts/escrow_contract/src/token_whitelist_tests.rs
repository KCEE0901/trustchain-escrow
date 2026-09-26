//! # Token whitelist tests
//!
//! Restored against the current contract API.
//! Issue #209: assert that add, remove, and toggle actions emit events that
//! backend indexers can consume.

#[cfg(test)]
#[allow(clippy::module_inception)]
mod token_whitelist_tests {
    use crate::{EscrowContract, EscrowContractClient, EscrowError, MultisigConfig};

    use soroban_sdk::{
        testutils::{Address as _, Events},
        Address, Env, Symbol, TryFromVal, Val,
    };

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
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = soroban_sdk::token::StellarAssetClient::new(env, &token_id.address());
        sac.mint(recipient, &amount);
        token_id.address()
    }

    /// Collect only events emitted by the escrow contract (not the SAC).
    fn contract_events(
        env: &Env,
        contract_id: &Address,
    ) -> soroban_sdk::Vec<(Address, soroban_sdk::Vec<Val>, Val)> {
        let all = env.events().all();
        let mut out = soroban_sdk::Vec::new(env);
        for ev in all.iter() {
            if ev.0 == *contract_id {
                out.push_back(ev);
            }
        }
        out
    }

    /// Returns the first topic symbol of an event.
    fn topic0(env: &Env, topics: &soroban_sdk::Vec<Val>) -> Symbol {
        Symbol::try_from_val(env, &topics.get(0).expect("at least one topic"))
            .expect("topic[0] should be a Symbol")
    }

    // ── Existing access-control tests ─────────────────────────────────────────

    #[test]
    fn test_add_remove_approved_token_admin_only() {
        let (env, admin, _, client) = setup();
        let non_admin = Address::generate(&env);
        let token = register_token(&env, &admin, &admin, 1000);

        // Non-admin cannot add token
        let result = client.try_add_approved_token(&non_admin, &token);
        assert!(result.is_err());

        // Admin can add token
        client.add_approved_token(&admin, &token);

        // Non-admin cannot remove token
        let result = client.try_remove_approved_token(&non_admin, &token);
        assert!(result.is_err());

        // Admin can remove token
        client.remove_approved_token(&admin, &token);
    }

    #[test]
    fn test_set_token_whitelist_enabled_admin_only() {
        let (env, admin, _, client) = setup();
        let non_admin = Address::generate(&env);

        // Non-admin cannot enable whitelist
        let result = client.try_set_token_whitelist_enabled(&non_admin, &true);
        assert!(result.is_err());

        // Admin can enable
        client.set_token_whitelist_enabled(&admin, &true);

        // Admin can disable
        client.set_token_whitelist_enabled(&admin, &false);
    }

    #[test]
    fn test_whitelist_enforcement() {
        let (env, admin, _, client) = setup();
        let client_addr = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let approved_token = register_token(&env, &admin, &client_addr, 1_001_000);
        let unapproved_token = register_token(&env, &admin, &client_addr, 1_001_000);
        let amount = 100;
        let brief_hash = soroban_sdk::BytesN::from_array(&env, &[4u8; 32]);

        // Enable whitelist
        client.set_token_whitelist_enabled(&admin, &true);

        // Add approved token
        client.add_approved_token(&admin, &approved_token);

        // Create escrow with approved token should succeed
        let escrow_id = client.create_escrow(
            &client_addr,
            &freelancer,
            &approved_token,
            &amount,
            &brief_hash,
            &None::<Address>,
            &None::<u64>,
            &None::<u64>,
            &None,
            &no_multisig(&env),
            &None,
        );
        // Escrow IDs start at 0, so assert the escrow exists rather than that the id is positive.
        assert_eq!(client.get_escrow_meta(&escrow_id).token, approved_token);

        // Create escrow with unapproved token should fail
        let result = client.try_create_escrow(
            &client_addr,
            &freelancer,
            &unapproved_token,
            &amount,
            &brief_hash,
            &None::<Address>,
            &None::<u64>,
            &None::<u64>,
            &None,
            &no_multisig(&env),
            &None,
        );
        assert!(result.is_err());
        assert_eq!(result.err().unwrap(), Ok(EscrowError::E3));

        // Disable whitelist
        client.set_token_whitelist_enabled(&admin, &false);

        // Now unapproved token should work
        let escrow_id2 = client.create_escrow(
            &client_addr,
            &freelancer,
            &unapproved_token,
            &amount,
            &brief_hash,
            &None::<Address>,
            &None::<u64>,
            &None::<u64>,
            &None,
            &no_multisig(&env),
            &None,
        );
        assert!(escrow_id2 > escrow_id);
    }

    // ── Issue #209: event assertions ──────────────────────────────────────────

    /// Adding a token emits `tok_wl_add` with (admin, token, active=true).
    #[test]
    fn test_add_approved_token_emits_event() {
        let (env, admin, contract_id, client) = setup();
        let token = register_token(&env, &admin, &admin, 1000);

        client.add_approved_token(&admin, &token);

        let events = contract_events(&env, &contract_id);
        assert!(!events.is_empty(), "expected at least one contract event");

        let last = events.get(events.len() - 1).unwrap();
        let (_contract, topics, data) = last;

        // Topic[0] must be the symbol `tok_wl_add`
        let sym = topic0(&env, &topics);
        assert_eq!(
            sym,
            soroban_sdk::symbol_short!("tok_wl_add"),
            "expected topic tok_wl_add, got {:?}",
            sym
        );

        // Data payload: (admin_address, token_address, active=true)
        let payload: (Address, Address, bool) =
            soroban_sdk::FromVal::from_val(&env, &data);
        assert_eq!(payload.0, admin, "event admin address mismatch");
        assert_eq!(payload.1, token, "event token address mismatch");
        assert!(payload.2, "active flag should be true on add");
    }

    /// Removing a token emits `tok_wl_rm` with (admin, token, active=false).
    #[test]
    fn test_remove_approved_token_emits_event() {
        let (env, admin, contract_id, client) = setup();
        let token = register_token(&env, &admin, &admin, 1000);

        // Add first so removal is valid
        client.add_approved_token(&admin, &token);

        // Clear events recorded so far before testing the remove event
        let events_before = contract_events(&env, &contract_id).len();

        client.remove_approved_token(&admin, &token);

        let events = contract_events(&env, &contract_id);
        // At least one new event must have been emitted
        assert!(
            events.len() > events_before,
            "expected a new event after remove_approved_token"
        );

        let last = events.get(events.len() - 1).unwrap();
        let (_contract, topics, data) = last;

        let sym = topic0(&env, &topics);
        assert_eq!(
            sym,
            soroban_sdk::symbol_short!("tok_wl_rm"),
            "expected topic tok_wl_rm, got {:?}",
            sym
        );

        let payload: (Address, Address, bool) =
            soroban_sdk::FromVal::from_val(&env, &data);
        assert_eq!(payload.0, admin, "event admin address mismatch");
        assert_eq!(payload.1, token, "event token address mismatch");
        assert!(!payload.2, "active flag should be false on remove");
    }

    /// Enabling the whitelist emits `tok_wl_set` with (admin, enabled=true).
    #[test]
    fn test_set_whitelist_enabled_emits_event() {
        let (env, admin, contract_id, client) = setup();

        client.set_token_whitelist_enabled(&admin, &true);

        let events = contract_events(&env, &contract_id);
        assert!(!events.is_empty(), "expected at least one contract event");

        let last = events.get(events.len() - 1).unwrap();
        let (_contract, topics, data) = last;

        let sym = topic0(&env, &topics);
        assert_eq!(
            sym,
            soroban_sdk::symbol_short!("tok_wl_set"),
            "expected topic tok_wl_set, got {:?}",
            sym
        );

        let payload: (Address, bool) = soroban_sdk::FromVal::from_val(&env, &data);
        assert_eq!(payload.0, admin, "event admin address mismatch");
        assert!(payload.1, "enabled flag should be true");
    }

    /// Disabling the whitelist emits `tok_wl_set` with (admin, enabled=false).
    #[test]
    fn test_set_whitelist_disabled_emits_event() {
        let (env, admin, contract_id, client) = setup();

        // Enable first
        client.set_token_whitelist_enabled(&admin, &true);
        let events_after_enable = contract_events(&env, &contract_id).len();

        // Now disable
        client.set_token_whitelist_enabled(&admin, &false);

        let events = contract_events(&env, &contract_id);
        assert!(
            events.len() > events_after_enable,
            "expected a new event after disabling whitelist"
        );

        let last = events.get(events.len() - 1).unwrap();
        let (_contract, topics, data) = last;

        let sym = topic0(&env, &topics);
        assert_eq!(
            sym,
            soroban_sdk::symbol_short!("tok_wl_set"),
            "expected topic tok_wl_set for disable, got {:?}",
            sym
        );

        let payload: (Address, bool) = soroban_sdk::FromVal::from_val(&env, &data);
        assert_eq!(payload.0, admin, "event admin address mismatch");
        assert!(!payload.1, "enabled flag should be false on disable");
    }

    /// Sequence test: add then remove and verify both events are present in order.
    #[test]
    fn test_add_then_remove_emits_two_whitelist_events() {
        let (env, admin, contract_id, client) = setup();
        let token = register_token(&env, &admin, &admin, 1000);

        client.add_approved_token(&admin, &token);
        client.remove_approved_token(&admin, &token);

        let events = contract_events(&env, &contract_id);
        // Last two contract events must be tok_wl_add and tok_wl_rm in that order
        let len = events.len();
        assert!(
            len >= 2,
            "expected at least 2 whitelist events, got {}",
            len
        );

        let add_event = events.get(len - 2).unwrap();
        let rem_event = events.get(len - 1).unwrap();

        let add_sym = topic0(&env, &add_event.1);
        let rem_sym = topic0(&env, &rem_event.1);

        assert_eq!(add_sym, soroban_sdk::symbol_short!("tok_wl_add"));
        assert_eq!(rem_sym, soroban_sdk::symbol_short!("tok_wl_rm"));
    }
}
