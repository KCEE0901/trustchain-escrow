//! Event completeness tests for milestone lookup (Issue #506).
//!
//! Every milestone creation emits `mil_idx` with the coordinates an indexer
//! needs to address the milestone directly — escrow id, dense milestone id
//! (== storage index), the resulting milestone count, amount and description
//! hash — so downstream lookups never require scanning. Rejected additions
//! emit nothing and leave the index range unchanged.

#[cfg(test)]
#[allow(clippy::module_inception)]
mod milestone_index_event_tests {
    extern crate std;

    use soroban_sdk::{
        symbol_short,
        testutils::{Address as _, Events},
        token, vec, Address, BytesN, Env, String, Symbol, TryFromVal,
    };
    use std::vec::Vec as StdVec;

    use crate::types::MilestoneIndexedEvent;
    use crate::{EscrowContract, EscrowContractClient, EscrowError, MultisigConfig};

    const AMOUNT: i128 = 1_000;

    struct Fixture {
        env: Env,
        contract_id: Address,
        client: EscrowContractClient<'static>,
        admin: Address,
        depositor: Address,
        token: Address,
    }

    fn setup() -> Fixture {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.initialize(&admin);

        let depositor = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        token::StellarAssetClient::new(&env, &sac.address())
            .mint(&depositor, &(AMOUNT * 3 + 2_000));

        Fixture {
            env,
            contract_id,
            client,
            admin,
            depositor,
            token: sac.address(),
        }
    }

    fn create(f: &Fixture) -> u64 {
        f.client.create_escrow(
            &f.depositor,
            &Address::generate(&f.env),
            &f.token,
            &AMOUNT,
            &BytesN::from_array(&f.env, &[5; 32]),
            &None,
            &None,
            &None,
            &None,
            &MultisigConfig {
                approvers: soroban_sdk::Vec::new(&f.env),
                weights: soroban_sdk::Vec::new(&f.env),
                threshold: 0,
            },
            &None,
        )
    }

    fn hash(f: &Fixture, seed: u8) -> BytesN<32> {
        BytesN::from_array(&f.env, &[seed; 32])
    }

    fn add(f: &Fixture, escrow_id: u64, seed: u8, amount: i128) -> u32 {
        f.client.add_milestone(
            &f.depositor,
            &escrow_id,
            &String::from_str(&f.env, "Work"),
            &hash(f, seed),
            &amount,
        )
    }

    /// All `mil_idx` payloads emitted by the escrow contract, oldest first,
    /// paired with the escrow id carried in topic[1].
    fn indexed(f: &Fixture) -> StdVec<(u64, MilestoneIndexedEvent)> {
        let mut out = StdVec::new();
        for (contract, topics, data) in f.env.events().all().iter() {
            if contract != f.contract_id {
                continue;
            }
            let is_idx = topics
                .get(0)
                .and_then(|t| Symbol::try_from_val(&f.env, &t).ok())
                .map(|s| s == symbol_short!("mil_idx"))
                .unwrap_or(false);
            if is_idx {
                assert_eq!(topics.len(), 2, "topics are (mil_idx, escrow_id)");
                let topic_escrow = u64::try_from_val(&f.env, &topics.get(1).unwrap()).unwrap();
                let payload = MilestoneIndexedEvent::try_from_val(&f.env, &data).unwrap();
                out.push((topic_escrow, payload));
            }
        }
        out
    }

    /// Every indexed milestone must be directly addressable by both lookup
    /// entrypoints and match what the event claimed.
    fn assert_lookups_match(f: &Fixture, events: &[(u64, MilestoneIndexedEvent)]) {
        for (topic_escrow, e) in events {
            assert_eq!(*topic_escrow, e.escrow_id);
            let by_id = f.client.get_milestone(&e.escrow_id, &e.milestone_id);
            let by_index = f
                .client
                .get_milestone_by_index(&e.escrow_id, &e.milestone_id);
            assert_eq!(by_id, by_index);
            assert_eq!(by_id.id, e.milestone_id);
            assert_eq!(by_id.amount, e.amount);
            assert_eq!(by_id.description_hash, e.description_hash);
        }
    }

    // ── Primary success path ─────────────────────────────────────────────────

    #[test]
    fn add_milestone_emits_complete_lookup_coordinates() {
        let f = setup();
        let escrow_id = create(&f);
        let mid = add(&f, escrow_id, 3, 300);

        let events = indexed(&f);
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].1,
            MilestoneIndexedEvent {
                escrow_id,
                milestone_id: mid,
                milestone_count: 1,
                amount: 300,
                description_hash: hash(&f, 3),
            }
        );
        assert_lookups_match(&f, &events);
    }

    #[test]
    fn sequential_adds_are_dense_and_counted() {
        let f = setup();
        let escrow_id = create(&f);
        for (seed, amount) in [(1_u8, 100_i128), (2, 200), (3, 300)] {
            add(&f, escrow_id, seed, amount);
        }

        let events = indexed(&f);
        let ids: StdVec<u32> = events.iter().map(|(_, e)| e.milestone_id).collect();
        let counts: StdVec<u32> = events.iter().map(|(_, e)| e.milestone_count).collect();
        assert_eq!(ids, [0, 1, 2]);
        assert_eq!(counts, [1, 2, 3]);
        assert_lookups_match(&f, &events);
    }

    #[test]
    fn batch_add_emits_one_event_per_milestone_continuing_the_sequence() {
        let f = setup();
        let escrow_id = create(&f);
        add(&f, escrow_id, 1, 100);

        let first = f.client.batch_add_milestones(
            &f.depositor,
            &escrow_id,
            &vec![
                &f.env,
                String::from_str(&f.env, "A"),
                String::from_str(&f.env, "B"),
                String::from_str(&f.env, "C"),
            ],
            &vec![&f.env, hash(&f, 7), hash(&f, 8), hash(&f, 9)],
            &vec![&f.env, 50_i128, 60, 70],
        );
        assert_eq!(first, 1);

        let events = indexed(&f);
        assert_eq!(events.len(), 4);
        let batch: StdVec<(u32, u32, i128)> = events[1..]
            .iter()
            .map(|(_, e)| (e.milestone_id, e.milestone_count, e.amount))
            .collect();
        assert_eq!(batch, [(1, 2, 50), (2, 3, 60), (3, 4, 70)]);
        assert_eq!(events[3].1.description_hash, hash(&f, 9));
        assert_lookups_match(&f, &events);
    }

    #[test]
    fn ids_are_scoped_per_escrow() {
        let f = setup();
        let a = create(&f);
        let b = create(&f);
        add(&f, a, 1, 100);
        add(&f, b, 2, 100);
        add(&f, a, 3, 100);

        let events = indexed(&f);
        let summary: StdVec<(u64, u32, u32)> = events
            .iter()
            .map(|(topic, e)| (*topic, e.milestone_id, e.milestone_count))
            .collect();
        assert_eq!(summary, [(a, 0, 1), (b, 0, 1), (a, 1, 2)]);
        assert_lookups_match(&f, &events);
    }

    // ── Failure / boundary paths ─────────────────────────────────────────────

    #[test]
    fn over_allocation_is_rejected_without_an_event_or_index_change() {
        let f = setup();
        let escrow_id = create(&f);
        add(&f, escrow_id, 1, 900);

        let result = f.client.try_add_milestone(
            &f.depositor,
            &escrow_id,
            &String::from_str(&f.env, "Too much"),
            &hash(&f, 2),
            &101_i128,
        );
        assert_eq!(result, Err(Ok(EscrowError::E15)));

        assert_eq!(indexed(&f).len(), 1);
        assert_eq!(
            f.client.try_get_milestone_by_index(&escrow_id, &1),
            Err(Ok(EscrowError::E13))
        );
    }

    #[test]
    fn capacity_limit_is_a_hard_boundary_for_single_and_batch_adds() {
        let f = setup();
        f.client.set_max_milestones(&f.admin, &2);
        let escrow_id = create(&f);
        add(&f, escrow_id, 1, 100);
        add(&f, escrow_id, 2, 100);

        let single = f.client.try_add_milestone(
            &f.depositor,
            &escrow_id,
            &String::from_str(&f.env, "Third"),
            &hash(&f, 3),
            &100_i128,
        );
        assert_eq!(single, Err(Ok(EscrowError::E16)));

        let batch = f.client.try_batch_add_milestones(
            &f.depositor,
            &escrow_id,
            &vec![&f.env, String::from_str(&f.env, "X")],
            &vec![&f.env, hash(&f, 4)],
            &vec![&f.env, 100_i128],
        );
        assert_eq!(batch, Err(Ok(EscrowError::E16)));

        let events = indexed(&f);
        assert_eq!(events.len(), 2);
        assert_eq!(events[1].1.milestone_count, 2);
        assert_eq!(
            f.client.try_get_milestone_by_index(&escrow_id, &2),
            Err(Ok(EscrowError::E13))
        );
    }

    #[test]
    fn malformed_batch_is_rejected_atomically() {
        let f = setup();
        let escrow_id = create(&f);

        // Mismatched vector lengths and a zero amount both fail before any
        // milestone is written or indexed.
        let mismatched = f.client.try_batch_add_milestones(
            &f.depositor,
            &escrow_id,
            &vec![
                &f.env,
                String::from_str(&f.env, "A"),
                String::from_str(&f.env, "B"),
            ],
            &vec![&f.env, hash(&f, 1)],
            &vec![&f.env, 10_i128, 20],
        );
        assert_eq!(mismatched, Err(Ok(EscrowError::E17)));

        let zero = f.client.try_batch_add_milestones(
            &f.depositor,
            &escrow_id,
            &vec![
                &f.env,
                String::from_str(&f.env, "A"),
                String::from_str(&f.env, "B"),
            ],
            &vec![&f.env, hash(&f, 1), hash(&f, 2)],
            &vec![&f.env, 10_i128, 0],
        );
        assert_eq!(zero, Err(Ok(EscrowError::E17)));

        assert!(indexed(&f).is_empty());
        assert_eq!(
            f.client.try_get_milestone_by_index(&escrow_id, &0),
            Err(Ok(EscrowError::E13))
        );
    }
}
