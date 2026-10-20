//! # Arbiter Selection Lifecycle — Event Completeness Tests
//!
//! Every `arb_upd` event must carry enough data for an indexer to rebuild the
//! arbiter history from events alone: the escrow ID, the arbiter before and
//! after the change, and the ledger position. Failed updates emit nothing.

#[cfg(test)]
#[allow(clippy::module_inception)]
mod arbiter_lifecycle_event_tests {
    extern crate std;

    use soroban_sdk::{
        testutils::{Address as _, Events, Ledger},
        token, Address, BytesN, Env, Symbol, TryFromVal, Val,
    };

    use crate::types::ArbiterUpdatedEvent;
    use crate::{EscrowContract, EscrowContractClient, EscrowError, MultisigConfig};

    struct Setup {
        env: Env,
        admin: Address,
        contract_id: Address,
        client: EscrowContractClient<'static>,
        buyer: Address,
        freelancer: Address,
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
        Setup {
            env,
            admin,
            contract_id,
            client,
            buyer,
            freelancer,
        }
    }

    fn create_escrow(s: &Setup, arbiter: Option<Address>) -> u64 {
        if let Some(ref a) = arbiter {
            if !s.client.is_arbiter_allowed(a) {
                s.client.add_to_arbiter_allowlist(&s.admin, a);
            }
        }
        let token_admin = Address::generate(&s.env);
        let sac = s.env.register_stellar_asset_contract_v2(token_admin);
        token::StellarAssetClient::new(&s.env, &sac.address()).mint(&s.buyer, &20_000_i128);
        s.client.create_escrow(
            &s.buyer,
            &s.freelancer,
            &sac.address(),
            &10_000_i128,
            &BytesN::from_array(&s.env, &[7; 32]),
            &arbiter,
            &None,
            &None,
            &None,
            &MultisigConfig {
                approvers: soroban_sdk::Vec::new(&s.env),
                weights: soroban_sdk::Vec::new(&s.env),
                threshold: 0,
            },
            &None,
        )
    }

    /// Raw `(topics, data)` of every `arb_upd` event from the escrow contract.
    fn raw_arbiter_events(s: &Setup) -> std::vec::Vec<(soroban_sdk::Vec<Val>, Val)> {
        let expected = Symbol::new(&s.env, "arb_upd");
        let mut out = std::vec::Vec::new();
        for (contract, topics, data) in s.env.events().all().iter() {
            if contract != s.contract_id {
                continue;
            }
            let is_arbiter_event = topics
                .get(0)
                .and_then(|name| Symbol::try_from_val(&s.env, &name).ok())
                .map(|name| name == expected)
                .unwrap_or(false);
            if is_arbiter_event {
                out.push((topics, data));
            }
        }
        out
    }

    /// Decoded `arb_upd` events as `(topic escrow id, payload)`, oldest first.
    fn arbiter_events(s: &Setup) -> std::vec::Vec<(u64, ArbiterUpdatedEvent)> {
        raw_arbiter_events(s)
            .into_iter()
            .map(|(topics, data)| {
                assert_eq!(topics.len(), 2, "arb_upd topics are (name, escrow_id)");
                let topic_id = u64::try_from_val(&s.env, &topics.get(1).unwrap())
                    .expect("arb_upd topic[1] must be the escrow id");
                let event = ArbiterUpdatedEvent::try_from_val(&s.env, &data)
                    .expect("arb_upd data must decode as ArbiterUpdatedEvent");
                (topic_id, event)
            })
            .collect()
    }

    // ── Success paths ────────────────────────────────────────────────────────

    #[test]
    fn test_replacing_arbiter_emits_complete_event() {
        let s = setup();
        let first = Address::generate(&s.env);
        let second = Address::generate(&s.env);
        let escrow_id = create_escrow(&s, Some(first.clone()));

        s.env.ledger().with_mut(|l| {
            l.timestamp += 60;
            l.sequence_number += 10;
        });
        let (timestamp, sequence) = (s.env.ledger().timestamp(), s.env.ledger().sequence());

        s.client.update_arbiter(&escrow_id, &Some(second.clone()));

        let events = arbiter_events(&s);
        assert_eq!(events.len(), 1);
        let (topic_id, event) = &events[0];
        assert_eq!(*topic_id, escrow_id);
        assert_eq!(
            *event,
            ArbiterUpdatedEvent {
                escrow_id,
                previous_arbiter: Some(first),
                new_arbiter: Some(second.clone()),
                updated_at: timestamp,
                ledger: sequence,
            }
        );
        assert_eq!(s.client.get_escrow(&escrow_id).arbiter, Some(second));
    }

    #[test]
    fn test_selecting_first_arbiter_reports_none_as_previous() {
        let s = setup();
        let arbiter = Address::generate(&s.env);
        let escrow_id = create_escrow(&s, None);

        s.client.update_arbiter(&escrow_id, &Some(arbiter.clone()));

        let (_, event) = arbiter_events(&s).pop().expect("arb_upd emitted");
        assert_eq!(event.previous_arbiter, None);
        assert_eq!(event.new_arbiter, Some(arbiter));
    }

    #[test]
    fn test_removing_arbiter_reports_previous_and_none() {
        let s = setup();
        let arbiter = Address::generate(&s.env);
        let escrow_id = create_escrow(&s, Some(arbiter.clone()));

        s.client.update_arbiter(&escrow_id, &None);

        let (_, event) = arbiter_events(&s).pop().expect("arb_upd emitted");
        assert_eq!(event.previous_arbiter, Some(arbiter));
        assert_eq!(event.new_arbiter, None);
        assert_eq!(s.client.get_escrow(&escrow_id).arbiter, None);
    }

    /// Replaying the events in order must reproduce the stored arbiter, and
    /// each event's `previous_arbiter` must chain to the one before it.
    #[test]
    fn test_event_history_replays_to_stored_arbiter() {
        let s = setup();
        let a = Address::generate(&s.env);
        let b = Address::generate(&s.env);
        let escrow_id = create_escrow(&s, Some(a.clone()));

        let mut replayed = Some(a.clone());
        for next in [Some(b.clone()), None, Some(a.clone()), Some(b.clone())] {
            s.env.ledger().with_mut(|l| l.sequence_number += 1);
            s.client.update_arbiter(&escrow_id, &next);

            let (_, event) = arbiter_events(&s).pop().expect("arb_upd emitted");
            assert_eq!(event.escrow_id, escrow_id);
            assert_eq!(event.previous_arbiter, replayed);
            replayed = event.new_arbiter;
        }
        assert_eq!(replayed, s.client.get_escrow(&escrow_id).arbiter);
    }

    // ── Failure and boundary paths ───────────────────────────────────────────

    #[test]
    fn test_rejected_arbiter_emits_no_event() {
        let s = setup();
        let escrow_id = create_escrow(&s, None);

        for invalid in [s.buyer.clone(), s.freelancer.clone()] {
            let result = s.client.try_update_arbiter(&escrow_id, &Some(invalid));
            assert_eq!(result, Err(Ok(EscrowError::E3)));
            assert!(arbiter_events(&s).is_empty());
        }
        assert_eq!(s.client.get_escrow(&escrow_id).arbiter, None);
    }

    #[test]
    fn test_unknown_escrow_emits_no_event() {
        let s = setup();
        let arbiter = Address::generate(&s.env);

        let result = s.client.try_update_arbiter(&999, &Some(arbiter));
        assert_eq!(result, Err(Ok(EscrowError::E8)));
        assert!(arbiter_events(&s).is_empty());
    }

    #[test]
    fn test_event_payload_contains_no_extra_fields() {
        let s = setup();
        let arbiter = Address::generate(&s.env);
        let escrow_id = create_escrow(&s, None);
        s.client.update_arbiter(&escrow_id, &Some(arbiter));

        // The payload is a fixed five-field struct: addresses and ledger data
        // only, so nothing else can leak into indexed data.
        let (_, data) = raw_arbiter_events(&s).pop().expect("arb_upd emitted");
        let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(&s.env, &data)
            .expect("payload is a struct");
        assert_eq!(map.len(), 5);
        for field in [
            "escrow_id",
            "previous_arbiter",
            "new_arbiter",
            "updated_at",
            "ledger",
        ] {
            assert!(
                map.contains_key(Symbol::new(&s.env, field)),
                "missing {}",
                field
            );
        }
    }
}
