//! Event completeness tests for deadline auto-cancellation (Issue #512).
//!
//! `trigger_expiry` must emit an `esc_exp` event whose topics and payload are
//! enough for an indexer to record the cancellation deterministically —
//! without reading contract state — while still emitting the generic
//! `esc_can` event for existing consumers. Failed expiries emit nothing and
//! move no funds.

#[cfg(test)]
#[allow(clippy::module_inception)]
mod expiry_event_tests {
    use soroban_sdk::{
        symbol_short,
        testutils::{Address as _, Events, Ledger},
        token, Address, BytesN, Env, Symbol, TryFromVal, Val,
    };

    use crate::types::EscrowExpiredEvent;
    use crate::{EscrowContract, EscrowContractClient, EscrowError, EscrowStatus, MultisigConfig};

    const AMOUNT: i128 = 1_000;
    const CREATED_AT: u64 = 10_000;
    const DEADLINE: u64 = 20_000;

    struct Fixture {
        env: Env,
        contract_id: Address,
        client: EscrowContractClient<'static>,
        depositor: Address,
        token: Address,
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
        env.ledger().with_mut(|l| l.timestamp = CREATED_AT);

        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.initialize(&admin);

        let depositor = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        token::StellarAssetClient::new(&env, &sac.address()).mint(&depositor, &(AMOUNT + 1_000));

        Fixture {
            env,
            contract_id,
            client,
            depositor,
            token: sac.address(),
        }
    }

    fn create(f: &Fixture, deadline: Option<u64>) -> u64 {
        let freelancer = Address::generate(&f.env);
        f.client.create_escrow(
            &f.depositor,
            &freelancer,
            &f.token,
            &AMOUNT,
            &BytesN::from_array(&f.env, &[7; 32]),
            &None,
            &deadline,
            &None,
            &None,
            &no_multisig(&f.env),
            &None,
        )
    }

    fn balance(f: &Fixture, who: &Address) -> i128 {
        token::Client::new(&f.env, &f.token).balance(who)
    }

    fn events_named(f: &Fixture, name: Symbol) -> soroban_sdk::Vec<(soroban_sdk::Vec<Val>, Val)> {
        let mut out = soroban_sdk::Vec::new(&f.env);
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
                out.push_back((topics, data));
            }
        }
        out
    }

    // ── Primary success path ─────────────────────────────────────────────────

    #[test]
    fn expiry_emits_a_complete_esc_exp_event() {
        let f = setup();
        let escrow_id = create(&f, Some(DEADLINE));
        let before = balance(&f, &f.depositor);

        let expired_at = DEADLINE + 1;
        f.env.ledger().with_mut(|l| l.timestamp = expired_at);
        let keeper = Address::generate(&f.env);
        let refunded = f.client.trigger_expiry(&keeper, &escrow_id);

        let expired = events_named(&f, symbol_short!("esc_exp"));
        assert_eq!(expired.len(), 1, "exactly one esc_exp event");
        let (topics, data) = expired.get(0).unwrap();

        // Topics: (name, escrow_id) — the escrow id is indexable without
        // decoding the payload.
        assert_eq!(topics.len(), 2);
        let topic_id = u64::try_from_val(&f.env, &topics.get(1).unwrap()).unwrap();
        assert_eq!(topic_id, escrow_id);

        let payload = EscrowExpiredEvent::try_from_val(&f.env, &data).unwrap();
        assert_eq!(
            payload,
            EscrowExpiredEvent {
                escrow_id,
                triggered_by: keeper.clone(),
                refunded_to: f.depositor.clone(),
                token: f.token.clone(),
                refunded_amount: AMOUNT,
                deadline: DEADLINE,
                expired_at,
            }
        );
        assert!(payload.expired_at > payload.deadline);

        // The payload agrees with what actually happened on-chain.
        assert_eq!(refunded, AMOUNT);
        assert_eq!(balance(&f, &f.depositor) - before, payload.refunded_amount);
        assert_eq!(
            f.client.get_escrow(&escrow_id).status,
            EscrowStatus::Cancelled
        );
    }

    #[test]
    fn generic_cancel_event_is_still_emitted_for_existing_consumers() {
        let f = setup();
        let escrow_id = create(&f, Some(DEADLINE));
        f.env.ledger().with_mut(|l| l.timestamp = DEADLINE + 1);
        f.client.trigger_expiry(&f.depositor, &escrow_id);

        let cancelled = events_named(&f, symbol_short!("esc_can"));
        assert_eq!(cancelled.len(), 1);
        let (topics, data) = cancelled.get(0).unwrap();
        assert_eq!(
            u64::try_from_val(&f.env, &topics.get(1).unwrap()).unwrap(),
            escrow_id
        );
        assert_eq!(i128::try_from_val(&f.env, &data).unwrap(), AMOUNT);
    }

    // ── Failure / boundary paths ─────────────────────────────────────────────

    #[test]
    fn expiry_at_exactly_the_deadline_is_rejected_without_side_effects() {
        let f = setup();
        let escrow_id = create(&f, Some(DEADLINE));
        let before = balance(&f, &f.depositor);

        f.env.ledger().with_mut(|l| l.timestamp = DEADLINE);
        let keeper = Address::generate(&f.env);
        assert_eq!(
            f.client.try_trigger_expiry(&keeper, &escrow_id),
            Err(Ok(EscrowError::E3))
        );

        assert!(!f.client.is_expired(&escrow_id));
        assert_eq!(f.client.get_escrow(&escrow_id).status, EscrowStatus::Active);
        assert_eq!(balance(&f, &f.depositor), before);
        assert_eq!(events_named(&f, symbol_short!("esc_exp")).len(), 0);
    }

    #[test]
    fn an_escrow_without_a_deadline_never_expires() {
        let f = setup();
        let escrow_id = create(&f, None);

        f.env.ledger().with_mut(|l| l.timestamp = u64::MAX / 2);
        let keeper = Address::generate(&f.env);
        assert_eq!(
            f.client.try_trigger_expiry(&keeper, &escrow_id),
            Err(Ok(EscrowError::E3))
        );
        assert_eq!(f.client.get_escrow(&escrow_id).status, EscrowStatus::Active);
        assert_eq!(events_named(&f, symbol_short!("esc_exp")).len(), 0);
    }

    #[test]
    fn a_second_expiry_is_rejected_and_does_not_refund_or_emit_again() {
        let f = setup();
        let escrow_id = create(&f, Some(DEADLINE));
        f.env.ledger().with_mut(|l| l.timestamp = DEADLINE + 1);
        let keeper = Address::generate(&f.env);
        f.client.trigger_expiry(&keeper, &escrow_id);
        let after_first = balance(&f, &f.depositor);

        f.env.ledger().with_mut(|l| l.timestamp = DEADLINE + 500);
        assert_eq!(
            f.client.try_trigger_expiry(&keeper, &escrow_id),
            Err(Ok(EscrowError::E9))
        );

        assert_eq!(balance(&f, &f.depositor), after_first, "no double refund");
        assert_eq!(events_named(&f, symbol_short!("esc_exp")).len(), 1);
    }
}
