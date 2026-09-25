//! Tests for partial_cancel functionality (Issue #705)
//! Event ordering tests added for Issue #217

#[cfg(test)]
#[allow(clippy::module_inception)]
mod partial_cancel_tests {
    use soroban_sdk::{
        testutils::{Address as _, Events},
        token, Address, BytesN, Env, String, Symbol, TryFromVal, Val,
    };

    use crate::{EscrowContract, EscrowContractClient, MultisigConfig};

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

    fn contract_events(
        env: &Env,
        contract_id: &Address,
    ) -> soroban_sdk::Vec<(Address, soroban_sdk::Vec<Val>, Val)> {
        let all = env.events().all();
        let mut out = soroban_sdk::Vec::new(env);
        for event in all.iter() {
            if event.0 == *contract_id {
                out.push_back(event);
            }
        }
        out
    }

    fn has_topic_symbol(env: &Env, topics: &soroban_sdk::Vec<Val>, expected: Symbol) -> bool {
        topics
            .get(0)
            .map(|val| {
                Symbol::try_from_val(env, &val).expect("event topic[0] should be a symbol")
                    == expected
            })
            .unwrap_or(false)
    }

    fn no_multisig(env: &Env) -> MultisigConfig {
        MultisigConfig {
            approvers: soroban_sdk::Vec::new(env),
            weights: soroban_sdk::Vec::new(env),
            threshold: 0,
        }
    }

    // Test 1: Successful partial cancel with unallocated balance
    #[test]
    fn test_partial_cancel_successful_refund() {
        let (env, admin, contract_id, client) = setup();
        let client_addr = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token = register_token(&env, &admin, &client_addr, 10_000);

        // Create escrow with 10,000 tokens
        let brief_hash = BytesN::from_array(&env, &[1; 32]);
        let escrow_id = client.create_escrow(
            &client_addr,
            &freelancer,
            &token,
            &10_000_i128,
            &brief_hash,
            &None,
            &None,
            &None,
            &None,
            &no_multisig(&env),
            &None,
        );

        // Add milestones totaling 6,000 tokens (leaving 4,000 unallocated)
        let m1_hash = BytesN::from_array(&env, &[2; 32]);
        let m1_title = String::from_str(&env, "Milestone 1");
        client.add_milestone(&client_addr, &escrow_id, &m1_title, &m1_hash, &3_000_i128);

        let m2_hash = BytesN::from_array(&env, &[3; 32]);
        let m2_title = String::from_str(&env, "Milestone 2");
        client.add_milestone(&client_addr, &escrow_id, &m2_title, &m2_hash, &3_000_i128);

        // Get client balance before partial cancel
        let client_balance_before = token::Client::new(&env, &token).balance(&client_addr);

        // Partial cancel - should refund 4,000 tokens
        let refunded = client.partial_cancel(&client_addr, &escrow_id);
        assert_eq!(refunded, 4_000_i128);

        // Verify client received the refund
        let client_balance_after = token::Client::new(&env, &token).balance(&client_addr);
        assert_eq!(client_balance_after - client_balance_before, 4_000_i128);

        // Verify event was emitted
        let events = contract_events(&env, &contract_id);
        let found = events
            .iter()
            .any(|(_, t, _)| has_topic_symbol(&env, &t, soroban_sdk::symbol_short!("prt_can")));
        assert!(found, "partial cancellation event not emitted");

        // Verify escrow is still active
        let escrow = client.get_escrow(&escrow_id);
        assert_eq!(
            escrow.status,
            crate::EscrowStatus::Active,
            "Escrow should remain active after partial cancel"
        );
        assert_eq!(escrow.remaining_balance, 6_000_i128);
    }

    // Test 2: Partial cancel with no unallocated balance
    #[test]
    fn test_partial_cancel_no_unallocated_balance() {
        let (env, admin, _contract_id, client) = setup();
        let client_addr = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token = register_token(&env, &admin, &client_addr, 10_000);

        // Create escrow with 10,000 tokens
        let brief_hash = BytesN::from_array(&env, &[1; 32]);
        let escrow_id = client.create_escrow(
            &client_addr,
            &freelancer,
            &token,
            &10_000_i128,
            &brief_hash,
            &None,
            &None,
            &None,
            &None,
            &no_multisig(&env),
            &None,
        );

        // Add milestones totaling exactly 10,000 tokens (no unallocated)
        let m1_hash = BytesN::from_array(&env, &[2; 32]);
        let m1_title = String::from_str(&env, "Milestone 1");
        client.add_milestone(&client_addr, &escrow_id, &m1_title, &m1_hash, &5_000_i128);

        let m2_hash = BytesN::from_array(&env, &[3; 32]);
        let m2_title = String::from_str(&env, "Milestone 2");
        client.add_milestone(&client_addr, &escrow_id, &m2_title, &m2_hash, &5_000_i128);

        // Partial cancel - should return 0
        let refunded = client.partial_cancel(&client_addr, &escrow_id);
        assert_eq!(refunded, 0_i128);

        // Verify no tokens were transferred
        let escrow = client.get_escrow(&escrow_id);
        assert_eq!(escrow.remaining_balance, 10_000_i128);
    }

    // Test 3: Partial cancel with auth failure (non-client caller)
    #[test]
    fn test_partial_cancel_auth_failure() {
        let (env, admin, _contract_id, client) = setup();
        let client_addr = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token = register_token(&env, &admin, &client_addr, 10_000);

        // Create escrow
        let brief_hash = BytesN::from_array(&env, &[1; 32]);
        let escrow_id = client.create_escrow(
            &client_addr,
            &freelancer,
            &token,
            &10_000_i128,
            &brief_hash,
            &None,
            &None,
            &None,
            &None,
            &no_multisig(&env),
            &None,
        );

        // Try to partial cancel as freelancer (should fail)
        let result = client.try_partial_cancel(&freelancer, &escrow_id);
        assert!(
            result.is_err(),
            "Freelancer should not be able to partial cancel"
        );
    }

    // Test 4: Partial cancel on non-active escrow
    #[test]
    fn test_partial_cancel_non_active_escrow() {
        let (env, admin, _contract_id, client) = setup();
        let client_addr = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token = register_token(&env, &admin, &client_addr, 10_000);

        // Create escrow
        let brief_hash = BytesN::from_array(&env, &[1; 32]);
        let escrow_id = client.create_escrow(
            &client_addr,
            &freelancer,
            &token,
            &10_000_i128,
            &brief_hash,
            &None,
            &None,
            &None,
            &None,
            &no_multisig(&env),
            &None,
        );

        // Cancel the escrow first
        client.cancel_escrow(&client_addr, &escrow_id);

        // Try to partial cancel (should fail because escrow is not active)
        let result = client.try_partial_cancel(&client_addr, &escrow_id);
        assert!(result.is_err(), "Cannot partial cancel non-active escrow");
    }

    // Test 5: Partial cancel with no milestones (full balance unallocated)
    #[test]
    fn test_partial_cancel_no_milestones() {
        let (env, admin, _contract_id, client) = setup();
        let client_addr = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token = register_token(&env, &admin, &client_addr, 10_000);

        // Create escrow with no milestones
        let brief_hash = BytesN::from_array(&env, &[1; 32]);
        let escrow_id = client.create_escrow(
            &client_addr,
            &freelancer,
            &token,
            &10_000_i128,
            &brief_hash,
            &None,
            &None,
            &None,
            &None,
            &no_multisig(&env),
            &None,
        );

        // Partial cancel - should refund entire balance
        let refunded = client.partial_cancel(&client_addr, &escrow_id);
        assert_eq!(refunded, 10_000_i128);

        // Verify remaining balance is 0
        let escrow = client.get_escrow(&escrow_id);
        assert_eq!(escrow.remaining_balance, 0_i128);
    }

    // ── Issue #217: partial cancel event ordering tests ────────────────────

    /// Collect first-topic symbol for every escrow-contract event, in emission order.
    fn event_symbol_sequence(env: &Env, contract_id: &Address) -> soroban_sdk::Vec<Symbol> {
        let mut out = soroban_sdk::Vec::new(env);
        for (_addr, topics, _data) in contract_events(env, contract_id).iter() {
            if let Some(raw) = topics.get(0) {
                if let Ok(sym) = Symbol::try_from_val(env, &raw) {
                    out.push_back(sym);
                }
            }
        }
        out
    }

    /// Assert that `needle` appears in `haystack` strictly after the last
    /// occurrence of `after_sym`.
    fn assert_symbol_after(
        env: &Env,
        haystack: &soroban_sdk::Vec<Symbol>,
        needle: Symbol,
        after_sym: Symbol,
    ) {
        let _ = env;
        let mut after_idx: Option<u32> = None;
        let mut needle_idx: Option<u32> = None;
        for i in 0..haystack.len() {
            let s = haystack.get(i).expect("index in range");
            if s == after_sym {
                after_idx = Some(i);
            }
            if s == needle && needle_idx.is_none() {
                needle_idx = Some(i);
            }
        }
        let after_pos = after_idx
            .unwrap_or_else(|| panic!("after_sym {:?} not found in event sequence", after_sym));
        let needle_pos = needle_idx
            .unwrap_or_else(|| panic!("needle {:?} not found in event sequence", needle));
        assert!(
            needle_pos > after_pos,
            "expected {:?} (pos {}) to appear after {:?} (pos {})",
            needle,
            needle_pos,
            after_sym,
            after_pos
        );
    }

    // Test 6: prt_can is emitted after esc_crt and mil_add in deterministic order.
    //
    // With two milestones totaling 6,000 and 4,000 unallocated the expected
    // sequence of contract events is:
    //   esc_crt → mil_add → mil_add → prt_can
    #[test]
    fn test_partial_cancel_event_order_after_esc_crt_and_mil_add() {
        let (env, admin, contract_id, client) = setup();
        let client_addr = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token = register_token(&env, &admin, &client_addr, 10_000);

        let brief_hash = BytesN::from_array(&env, &[1; 32]);
        let escrow_id = client.create_escrow(
            &client_addr,
            &freelancer,
            &token,
            &10_000_i128,
            &brief_hash,
            &None,
            &None,
            &None,
            &None,
            &no_multisig(&env),
            &None,
        );

        // Allocate 6,000 — 4,000 remains unallocated.
        client.add_milestone(
            &client_addr,
            &escrow_id,
            &String::from_str(&env, "M1"),
            &BytesN::from_array(&env, &[2; 32]),
            &3_000_i128,
        );
        client.add_milestone(
            &client_addr,
            &escrow_id,
            &String::from_str(&env, "M2"),
            &BytesN::from_array(&env, &[3; 32]),
            &3_000_i128,
        );

        let refunded = client.partial_cancel(&client_addr, &escrow_id);
        assert_eq!(refunded, 4_000_i128, "unexpected refund amount");

        let syms = event_symbol_sequence(&env, &contract_id);

        // prt_can must appear after esc_crt.
        assert_symbol_after(
            &env,
            &syms,
            soroban_sdk::symbol_short!("prt_can"),
            soroban_sdk::symbol_short!("esc_crt"),
        );

        // prt_can must appear after the last mil_add.
        assert_symbol_after(
            &env,
            &syms,
            soroban_sdk::symbol_short!("prt_can"),
            soroban_sdk::symbol_short!("mil_add"),
        );

        // Exactly one prt_can event.
        let prt_can_count = syms
            .iter()
            .filter(|s| *s == soroban_sdk::symbol_short!("prt_can"))
            .count();
        assert_eq!(prt_can_count, 1, "expected exactly one prt_can event");

        // Escrow stays Active; balance reduced by 4,000.
        let escrow = client.get_escrow(&escrow_id);
        assert_eq!(escrow.status, crate::EscrowStatus::Active);
        assert_eq!(escrow.remaining_balance, 6_000_i128);
    }

    // Test 7: prt_can payload equals the refunded amount and event ordering
    // is preserved with a single pending milestone.
    //
    // Expected sequence: esc_crt → mil_add → prt_can
    #[test]
    fn test_partial_cancel_event_payload_and_order_single_milestone() {
        let (env, admin, contract_id, client) = setup();
        let client_addr = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token = register_token(&env, &admin, &client_addr, 10_000);

        let brief_hash = BytesN::from_array(&env, &[4; 32]);
        let escrow_id = client.create_escrow(
            &client_addr,
            &freelancer,
            &token,
            &10_000_i128,
            &brief_hash,
            &None,
            &None,
            &None,
            &None,
            &no_multisig(&env),
            &None,
        );

        // Allocate 5,000 — 5,000 remains unallocated.
        client.add_milestone(
            &client_addr,
            &escrow_id,
            &String::from_str(&env, "Only milestone"),
            &BytesN::from_array(&env, &[5; 32]),
            &5_000_i128,
        );

        let refunded = client.partial_cancel(&client_addr, &escrow_id);
        assert_eq!(refunded, 5_000_i128);

        let syms = event_symbol_sequence(&env, &contract_id);

        // Strict ordering: esc_crt < mil_add < prt_can.
        assert_symbol_after(
            &env,
            &syms,
            soroban_sdk::symbol_short!("mil_add"),
            soroban_sdk::symbol_short!("esc_crt"),
        );
        assert_symbol_after(
            &env,
            &syms,
            soroban_sdk::symbol_short!("prt_can"),
            soroban_sdk::symbol_short!("mil_add"),
        );

        // The prt_can data payload must equal the refunded amount.
        let all = contract_events(&env, &contract_id);
        let prt_can_data = all
            .iter()
            .find(|(_a, topics, _d)| {
                has_topic_symbol(&env, topics, soroban_sdk::symbol_short!("prt_can"))
            })
            .map(|(_a, _t, data)| data)
            .expect("prt_can event must be present");

        let amount =
            i128::try_from_val(&env, &prt_can_data).expect("prt_can data must be i128 amount");
        assert_eq!(amount, 5_000_i128, "prt_can payload must equal refunded amount");
    }

    // Test 8: No prt_can event emitted when the unallocated balance is zero.
    #[test]
    fn test_partial_cancel_no_event_emitted_when_nothing_to_refund() {
        let (env, admin, contract_id, client) = setup();
        let client_addr = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token = register_token(&env, &admin, &client_addr, 10_000);

        let brief_hash = BytesN::from_array(&env, &[6; 32]);
        let escrow_id = client.create_escrow(
            &client_addr,
            &freelancer,
            &token,
            &10_000_i128,
            &brief_hash,
            &None,
            &None,
            &None,
            &None,
            &no_multisig(&env),
            &None,
        );

        // Fully allocate — no unallocated funds remain.
        client.add_milestone(
            &client_addr,
            &escrow_id,
            &String::from_str(&env, "M1"),
            &BytesN::from_array(&env, &[7; 32]),
            &5_000_i128,
        );
        client.add_milestone(
            &client_addr,
            &escrow_id,
            &String::from_str(&env, "M2"),
            &BytesN::from_array(&env, &[8; 32]),
            &5_000_i128,
        );

        let refunded = client.partial_cancel(&client_addr, &escrow_id);
        assert_eq!(refunded, 0_i128);

        let syms = event_symbol_sequence(&env, &contract_id);

        // No prt_can event when nothing is refunded.
        let prt_can_count = syms
            .iter()
            .filter(|s| *s == soroban_sdk::symbol_short!("prt_can"))
            .count();
        assert_eq!(
            prt_can_count, 0,
            "prt_can must NOT be emitted when refunded amount is zero"
        );
    }

    // Test 9: Sequential partial cancel calls produce events in emission order.
    //
    // First call refunds unallocated funds and emits prt_can.
    // Second call finds nothing to refund and emits no prt_can.
    // Total prt_can count across both calls must be exactly 1.
    #[test]
    fn test_partial_cancel_sequential_calls_emit_ordered_events() {
        let (env, admin, contract_id, client) = setup();
        let client_addr = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token = register_token(&env, &admin, &client_addr, 15_000);

        let brief_hash = BytesN::from_array(&env, &[9; 32]);
        let escrow_id = client.create_escrow(
            &client_addr,
            &freelancer,
            &token,
            &15_000_i128,
            &brief_hash,
            &None,
            &None,
            &None,
            &None,
            &no_multisig(&env),
            &None,
        );

        // Allocate 5,000 — 10,000 unallocated.
        client.add_milestone(
            &client_addr,
            &escrow_id,
            &String::from_str(&env, "M1"),
            &BytesN::from_array(&env, &[10; 32]),
            &5_000_i128,
        );

        // First call — refunds 10,000.
        let first_refund = client.partial_cancel(&client_addr, &escrow_id);
        assert_eq!(first_refund, 10_000_i128);

        // Second call — nothing unallocated, returns 0.
        let second_refund = client.partial_cancel(&client_addr, &escrow_id);
        assert_eq!(second_refund, 0_i128);

        let syms = event_symbol_sequence(&env, &contract_id);

        // Exactly one prt_can (the second call emits none).
        let prt_can_count = syms
            .iter()
            .filter(|s| *s == soroban_sdk::symbol_short!("prt_can"))
            .count();
        assert_eq!(prt_can_count, 1, "only the first partial cancel should emit prt_can");

        // The single prt_can must still follow esc_crt and mil_add.
        assert_symbol_after(
            &env,
            &syms,
            soroban_sdk::symbol_short!("prt_can"),
            soroban_sdk::symbol_short!("esc_crt"),
        );
        assert_symbol_after(
            &env,
            &syms,
            soroban_sdk::symbol_short!("prt_can"),
            soroban_sdk::symbol_short!("mil_add"),
        );
    }
}
