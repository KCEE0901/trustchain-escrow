//! Wrapped token registry enforcement: event completeness (Issue #503) and
//! fuzz coverage (Issue #502).
//!
//! The crate has no fuzzing dependency, so — like `property_invariant_tests`
//! — the fuzz cases use a small deterministic xorshift PRNG: every run
//! generates the same malformed and boundary inputs, and each step is checked
//! against a model of the registry so failures are reproducible.

#[cfg(test)]
#[allow(clippy::module_inception)]
mod bridge_registry_tests {
    extern crate std;

    use soroban_sdk::{
        symbol_short,
        testutils::{Address as _, Events, Ledger},
        token, Address, BytesN, Env, String, Symbol, TryFromVal, Val,
    };
    use std::vec::Vec as StdVec;

    use crate::bridge::{
        BridgeProtocol, WrappedTokenInfo, WrappedTokenRegisteredEvent, MAX_WRAPPED_TOKEN_FIELD_LEN,
        MIN_BRIDGE_CONFIRMATIONS,
    };
    use crate::{EscrowContract, EscrowContractClient, EscrowError, MultisigConfig};

    struct Fixture {
        env: Env,
        contract_id: Address,
        client: EscrowContractClient<'static>,
        admin: Address,
    }

    fn setup() -> Fixture {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 50_000);
        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.initialize(&admin);
        Fixture {
            env,
            contract_id,
            client,
            admin,
        }
    }

    fn info(f: &Fixture, token: &Address, approved: bool) -> WrappedTokenInfo {
        WrappedTokenInfo {
            stellar_address: token.clone(),
            origin_chain: String::from_str(&f.env, "ethereum"),
            origin_address: String::from_str(&f.env, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
            bridge: BridgeProtocol::Wormhole,
            is_approved: approved,
        }
    }

    fn events_named(f: &Fixture, name: Symbol) -> StdVec<(soroban_sdk::Vec<Val>, Val)> {
        let mut out = StdVec::new();
        for (contract, topics, data) in f.env.events().all().iter() {
            if contract != f.contract_id {
                continue;
            }
            let matches = topics
                .get(0)
                .and_then(|t| Symbol::try_from_val(&f.env, &t).ok())
                .map(|s| s == name)
                .unwrap_or(false);
            if matches {
                out.push((topics, data));
            }
        }
        out
    }

    fn registry_events(f: &Fixture) -> StdVec<(Address, WrappedTokenRegisteredEvent)> {
        events_named(f, symbol_short!("wtk_reg"))
            .into_iter()
            .map(|(topics, data)| {
                assert_eq!(topics.len(), 2, "topics are (wtk_reg, token)");
                (
                    Address::try_from_val(&f.env, &topics.get(1).unwrap()).unwrap(),
                    WrappedTokenRegisteredEvent::try_from_val(&f.env, &data).unwrap(),
                )
            })
            .collect()
    }

    fn no_multisig(env: &Env) -> MultisigConfig {
        MultisigConfig {
            approvers: soroban_sdk::Vec::new(env),
            weights: soroban_sdk::Vec::new(env),
            threshold: 0,
        }
    }

    // ── #503: event completeness ─────────────────────────────────────────────

    #[test]
    fn first_registration_emits_the_full_record() {
        let f = setup();
        let token = Address::generate(&f.env);
        f.client
            .register_wrapped_token(&f.admin, &info(&f, &token, true));

        let events = registry_events(&f);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, token);
        assert_eq!(
            events[0].1,
            WrappedTokenRegisteredEvent {
                stellar_address: token.clone(),
                origin_chain: String::from_str(&f.env, "ethereum"),
                origin_address: String::from_str(
                    &f.env,
                    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
                ),
                bridge: BridgeProtocol::Wormhole,
                is_approved: true,
                previous_is_approved: None,
                registered_by: f.admin.clone(),
                registered_at: 50_000,
            }
        );

        // The legacy event is still emitted for existing consumers.
        let legacy = events_named(&f, symbol_short!("brg_reg"));
        assert_eq!(legacy.len(), 1);
        assert_eq!(
            String::try_from_val(&f.env, &legacy[0].1).unwrap(),
            String::from_str(&f.env, "ethereum")
        );
    }

    #[test]
    fn revoking_approval_is_visible_in_the_event_and_enforced() {
        let f = setup();
        let sac = f.env.register_stellar_asset_contract_v2(f.admin.clone());
        let token = sac.address();
        let depositor = Address::generate(&f.env);
        token::StellarAssetClient::new(&f.env, &token).mint(&depositor, &5_000);

        f.client
            .register_wrapped_token(&f.admin, &info(&f, &token, true));
        f.client.update_bridge_confirmation(
            &token,
            &BridgeProtocol::Wormhole,
            &MIN_BRIDGE_CONFIRMATIONS,
        );
        f.env.ledger().with_mut(|l| l.timestamp = 60_000);
        f.client
            .register_wrapped_token(&f.admin, &info(&f, &token, false));

        let events = registry_events(&f);
        assert_eq!(events.len(), 2);
        let revocation = &events[1].1;
        assert_eq!(revocation.previous_is_approved, Some(true));
        assert!(!revocation.is_approved);
        assert_eq!(revocation.registered_at, 60_000);

        // What the event says is what the contract enforces.
        let result = f.client.try_create_escrow(
            &depositor,
            &Address::generate(&f.env),
            &token,
            &1_000,
            &BytesN::from_array(&f.env, &[1; 32]),
            &None,
            &None,
            &None,
            &None,
            &no_multisig(&f.env),
            &None,
        );
        assert_eq!(result, Err(Ok(EscrowError::E54)));
    }

    #[test]
    fn non_admin_registration_is_rejected_without_an_event() {
        let f = setup();
        let token = Address::generate(&f.env);
        let stranger = Address::generate(&f.env);

        assert_eq!(
            f.client
                .try_register_wrapped_token(&stranger, &info(&f, &token, true)),
            Err(Ok(EscrowError::E4))
        );
        assert!(f.client.get_wrapped_token_info(&token).is_none());
        assert!(registry_events(&f).is_empty());
    }

    #[test]
    fn malformed_metadata_is_rejected_before_anything_is_stored() {
        let f = setup();
        let token = Address::generate(&f.env);
        let long = "x".repeat(MAX_WRAPPED_TOKEN_FIELD_LEN as usize + 1);

        let mut empty_chain = info(&f, &token, true);
        empty_chain.origin_chain = String::from_str(&f.env, "");
        let mut empty_origin = info(&f, &token, true);
        empty_origin.origin_address = String::from_str(&f.env, "");
        let mut long_chain = info(&f, &token, true);
        long_chain.origin_chain = String::from_str(&f.env, &long);
        let self_registration = info(&f, &f.contract_id, true);

        for (bad, expected) in [
            (empty_chain, EscrowError::E80),
            (empty_origin, EscrowError::E80),
            (long_chain, EscrowError::E81),
            (self_registration, EscrowError::E80),
        ] {
            assert_eq!(
                f.client.try_register_wrapped_token(&f.admin, &bad),
                Err(Ok(expected))
            );
        }

        assert!(f.client.get_wrapped_token_info(&token).is_none());
        assert!(f.client.get_wrapped_token_info(&f.contract_id).is_none());
        assert!(registry_events(&f).is_empty());
    }

    #[test]
    fn origin_fields_at_exactly_the_limit_are_accepted() {
        let f = setup();
        let token = Address::generate(&f.env);
        let max = "y".repeat(MAX_WRAPPED_TOKEN_FIELD_LEN as usize);
        let mut boundary = info(&f, &token, true);
        boundary.origin_chain = String::from_str(&f.env, &max);
        boundary.origin_address = String::from_str(&f.env, &max);

        f.client.register_wrapped_token(&f.admin, &boundary);
        assert_eq!(
            f.client
                .get_wrapped_token_info(&token)
                .unwrap()
                .origin_chain,
            String::from_str(&f.env, &max)
        );
    }

    // ── #502: fuzz coverage ──────────────────────────────────────────────────

    /// xorshift64* — deterministic and dependency-free.
    struct Rng(u64);

    impl Rng {
        fn next(&mut self) -> u64 {
            let mut x = self.0;
            x ^= x >> 12;
            x ^= x << 25;
            x ^= x >> 27;
            self.0 = x;
            x.wrapping_mul(0x2545_F491_4F6C_DD1D)
        }

        fn below(&mut self, n: u64) -> u64 {
            self.next() % n
        }

        fn chance(&mut self, percent: u64) -> bool {
            self.below(100) < percent
        }
    }

    /// A field length biased towards the interesting boundaries.
    fn fuzz_len(rng: &mut Rng) -> usize {
        let max = MAX_WRAPPED_TOKEN_FIELD_LEN as usize;
        match rng.below(8) {
            0 => 0,
            1 => 1,
            2 => max - 1,
            3 => max,
            4 => max + 1,
            5 => max + 1 + rng.below(64) as usize,
            _ => 1 + rng.below(40) as usize,
        }
    }

    /// Mixes ASCII with a two-byte character so byte length != char count.
    fn fuzz_string(rng: &mut Rng, len: usize) -> std::string::String {
        let mut s = std::string::String::new();
        while s.len() < len {
            if len - s.len() >= 2 && rng.chance(10) {
                s.push('é');
            } else {
                s.push((b'a' + rng.below(26) as u8) as char);
            }
        }
        s
    }

    fn expected_outcome(
        contract: &Address,
        token: &Address,
        chain: &str,
        origin: &str,
    ) -> Result<(), EscrowError> {
        let max = MAX_WRAPPED_TOKEN_FIELD_LEN as usize;
        if token == contract {
            return Err(EscrowError::E80);
        }
        for field in [chain, origin] {
            if field.is_empty() {
                return Err(EscrowError::E80);
            }
            if field.len() > max {
                return Err(EscrowError::E81);
            }
        }
        Ok(())
    }

    #[test]
    fn fuzz_registry_matches_model_for_malformed_and_boundary_inputs() {
        let f = setup();
        // Hundreds of invocations in one env: lift the test budget ceiling.
        f.env.budget().reset_unlimited();
        let mut rng = Rng(0x5EED_0502_u64);

        // Tokens are drawn from a small pool so re-registrations are common;
        // the escrow contract itself is included as a malformed target.
        let mut pool: StdVec<Address> = (0..4).map(|_| Address::generate(&f.env)).collect();
        pool.push(f.contract_id.clone());
        let mut model: StdVec<Option<WrappedTokenInfo>> = std::vec![None; pool.len()];
        let mut successes = 0_usize;

        for step in 0..200_u64 {
            f.env.ledger().with_mut(|l| l.timestamp = 50_000 + step);
            let slot = rng.below(pool.len() as u64) as usize;
            let token = pool[slot].clone();
            let chain_len = fuzz_len(&mut rng);
            let chain = fuzz_string(&mut rng, chain_len);
            let origin_len = fuzz_len(&mut rng);
            let origin = fuzz_string(&mut rng, origin_len);
            let candidate = WrappedTokenInfo {
                stellar_address: token.clone(),
                origin_chain: String::from_str(&f.env, &chain),
                origin_address: String::from_str(&f.env, &origin),
                bridge: if rng.chance(50) {
                    BridgeProtocol::Wormhole
                } else {
                    BridgeProtocol::Allbridge
                },
                is_approved: rng.chance(50),
            };
            // Occasionally an unauthorized caller tries the same write.
            let caller = if rng.chance(15) {
                Address::generate(&f.env)
            } else {
                f.admin.clone()
            };

            let expected = if caller != f.admin {
                Err(EscrowError::E4)
            } else {
                expected_outcome(&f.contract_id, &token, &chain, &origin)
            };
            let actual = f.client.try_register_wrapped_token(&caller, &candidate);
            match expected {
                Ok(()) => {
                    assert!(
                        actual.is_ok(),
                        "step {step}: expected success, got {actual:?}"
                    );
                    let previous = model[slot].as_ref().map(|p| p.is_approved);
                    model[slot] = Some(candidate.clone());
                    successes += 1;

                    let events = registry_events(&f);
                    let (topic, last) = events.last().expect("wtk_reg emitted");
                    assert_eq!(*topic, token, "step {step}");
                    assert_eq!(last.previous_is_approved, previous, "step {step}");
                    assert_eq!(last.is_approved, candidate.is_approved, "step {step}");
                    assert_eq!(last.origin_chain, candidate.origin_chain, "step {step}");
                    assert_eq!(last.origin_address, candidate.origin_address, "step {step}");
                    assert_eq!(last.bridge, candidate.bridge, "step {step}");
                    assert_eq!(last.registered_at, 50_000 + step, "step {step}");
                }
                Err(code) => {
                    assert_eq!(actual, Err(Ok(code)), "step {step}");
                }
            }

            // Invariant: storage always equals the model — rejected writes
            // never change a record, and the contract is never registered.
            for (i, t) in pool.iter().enumerate() {
                let stored = f.client.get_wrapped_token_info(t);
                match &model[i] {
                    None => assert!(stored.is_none(), "step {step}: slot {i} should be empty"),
                    Some(m) => {
                        let s = stored.expect("registered token readable");
                        assert_eq!(s.origin_chain, m.origin_chain, "step {step}");
                        assert_eq!(s.origin_address, m.origin_address, "step {step}");
                        assert_eq!(s.bridge, m.bridge, "step {step}");
                        assert_eq!(s.is_approved, m.is_approved, "step {step}");
                    }
                }
            }
        }

        // Exactly one wtk_reg (and one brg_reg) per accepted write.
        assert_eq!(registry_events(&f).len(), successes);
        assert_eq!(events_named(&f, symbol_short!("brg_reg")).len(), successes);
        assert!(
            successes > 0 && successes < 200,
            "fuzz should hit both outcomes"
        );
        assert!(model[pool.len() - 1].is_none());
    }

    #[test]
    fn fuzz_escrow_creation_honours_registry_and_finality() {
        let f = setup();
        // Hundreds of invocations in one env: lift the test budget ceiling.
        f.env.budget().reset_unlimited();
        let mut rng = Rng(0xB21D_6E50_u64);
        let depositor = Address::generate(&f.env);

        let tokens: StdVec<Address> = (0..2)
            .map(|_| {
                let t = f
                    .env
                    .register_stellar_asset_contract_v2(f.admin.clone())
                    .address();
                token::StellarAssetClient::new(&f.env, &t).mint(&depositor, &1_000_000);
                t
            })
            .collect();
        // Per token: (registered approval, latest confirmations).
        let mut state: StdVec<(Option<bool>, Option<u32>)> = std::vec![(None, None); tokens.len()];

        for step in 0..60_u32 {
            let i = rng.below(tokens.len() as u64) as usize;
            let t = &tokens[i];
            match rng.below(3) {
                0 => {
                    let approved = rng.chance(60);
                    f.client
                        .register_wrapped_token(&f.admin, &info(&f, t, approved));
                    state[i].0 = Some(approved);
                }
                1 => {
                    // Confirmations around the finality threshold, including 0.
                    let confirmations = match rng.below(4) {
                        0 => 0,
                        1 => MIN_BRIDGE_CONFIRMATIONS - 1,
                        2 => MIN_BRIDGE_CONFIRMATIONS,
                        _ => MIN_BRIDGE_CONFIRMATIONS + rng.below(100) as u32,
                    };
                    let protocol = if rng.chance(50) {
                        BridgeProtocol::Wormhole
                    } else {
                        BridgeProtocol::Allbridge
                    };
                    f.client
                        .update_bridge_confirmation(t, &protocol, &confirmations);
                    state[i].1 = Some(confirmations);
                }
                _ => {
                    let usable = match state[i] {
                        // Never registered: a plain Stellar asset is allowed.
                        (None, _) => true,
                        (Some(approved), confirmations) => {
                            approved && confirmations.is_some_and(|c| c >= MIN_BRIDGE_CONFIRMATIONS)
                        }
                    };
                    let result = f.client.try_create_escrow(
                        &depositor,
                        &Address::generate(&f.env),
                        t,
                        &1_000,
                        &BytesN::from_array(&f.env, &[step as u8 + 1; 32]),
                        &None,
                        &None,
                        &None,
                        &None,
                        &no_multisig(&f.env),
                        &None,
                    );
                    if usable {
                        assert!(
                            result.is_ok(),
                            "step {step}: expected escrow, got {result:?}"
                        );
                    } else {
                        assert_eq!(result, Err(Ok(EscrowError::E54)), "step {step}");
                    }
                }
            }
        }
    }
}
