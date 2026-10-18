//! # Milestone Lookup Scalability — Storage-Growth Benchmark
//!
//! Milestones are stored one entry per milestone, keyed by
//! `(escrow_id, milestone_id)`, so lookups stay O(1) as an escrow fills up.
//! These benchmarks hold that design to the budget in `types.rs`:
//!
//! - adding milestones never grows `EscrowMeta`
//!   (`ESCROW_META_GROWTH_PER_MILESTONE_BYTES`);
//! - each milestone entry stays within `MILESTONE_ENTRY_MAX_BYTES`;
//! - adding N milestones writes exactly N milestone entries;
//! - looking up the first or last milestone of a full escrow costs the same,
//!   within `MILESTONE_LOOKUP_MAX_COST_SPREAD_PCT`.
//!
//! Each benchmark prints a line for trend tracking:
//!   STORAGE_PROFILE | escrow_contract | <workload> | ...

#[cfg(test)]
#[allow(clippy::module_inception)]
mod milestone_storage_growth_tests {
    extern crate std;

    use std::println;

    use soroban_sdk::{testutils::Address as _, token, xdr::ToXdr, Address, BytesN, Env, String};

    use crate::types::{
        ESCROW_META_GROWTH_PER_MILESTONE_BYTES, MILESTONE_ENTRY_MAX_BYTES,
        MILESTONE_LOOKUP_MAX_COST_SPREAD_PCT,
    };
    use crate::{
        EscrowContract, EscrowContractClient, EscrowError, EscrowMeta, Milestone, MultisigConfig,
        PackedDataKey, MAX_MILESTONES, MAX_STRING_LEN,
    };

    const AMOUNT_EACH: i128 = 100;

    struct Setup {
        env: Env,
        contract_id: Address,
        client: EscrowContractClient<'static>,
        buyer: Address,
        escrow_id: u64,
    }

    /// An escrow funded for more than `MAX_MILESTONES` milestones, with none yet.
    fn setup() -> Setup {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.initialize(&admin);

        let buyer = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(admin).address();
        // Headroom beyond the cap so over-cap writes fail on capacity (E16),
        // not on allocation (E15).
        let total = AMOUNT_EACH * i128::from(MAX_MILESTONES) + 1_000;
        // Extra covers the per-entry rent reserve charged on every write.
        token::StellarAssetClient::new(&env, &token_id).mint(&buyer, &(total + 100_000));

        let escrow_id = client.create_escrow(
            &buyer,
            &freelancer,
            &token_id,
            &total,
            &BytesN::from_array(&env, &[5; 32]),
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
            buyer,
            escrow_id,
        }
    }

    fn add(s: &Setup, title: &str) -> u32 {
        s.client.add_milestone(
            &s.buyer,
            &s.escrow_id,
            &String::from_str(&s.env, title),
            &BytesN::from_array(&s.env, &[9; 32]),
            &AMOUNT_EACH,
        )
    }

    fn meta_bytes(s: &Setup) -> u32 {
        s.env.as_contract(&s.contract_id, || {
            let meta: EscrowMeta = s
                .env
                .storage()
                .persistent()
                .get(&PackedDataKey::EscrowMeta(s.escrow_id))
                .expect("escrow meta is stored");
            meta.to_xdr(&s.env).len()
        })
    }

    fn milestone_bytes(s: &Setup, milestone_id: u32) -> Option<u32> {
        s.env.as_contract(&s.contract_id, || {
            s.env
                .storage()
                .persistent()
                .get::<_, Milestone>(&PackedDataKey::Milestone(s.escrow_id, milestone_id))
                .map(|m| m.to_xdr(&s.env).len())
        })
    }

    /// Number of milestone entries stored for the escrow, probing one past
    /// the configured cap so a stray extra write is caught.
    fn stored_milestones(s: &Setup) -> u32 {
        (0..=MAX_MILESTONES)
            .filter(|id| milestone_bytes(s, *id).is_some())
            .count() as u32
    }

    fn lookup_cpu(s: &Setup, milestone_id: u32) -> u64 {
        s.env.budget().reset_default();
        s.client.get_milestone(&s.escrow_id, &milestone_id);
        s.env.budget().cpu_instruction_cost()
    }

    // ── Primary path ─────────────────────────────────────────────────────────

    #[test]
    fn bench_meta_does_not_grow_with_milestones() {
        let s = setup();
        add(&s, "first");
        let after_one = meta_bytes(&s);

        for i in 1..MAX_MILESTONES {
            assert_eq!(add(&s, "next"), i);
        }
        let after_full = meta_bytes(&s);
        let growth = after_full.saturating_sub(after_one);
        println!(
            "STORAGE_PROFILE | escrow_contract | add_milestone_x{} | meta_bytes={} | growth={} | budget={}",
            MAX_MILESTONES, after_full, growth, ESCROW_META_GROWTH_PER_MILESTONE_BYTES
        );

        assert!(
            growth <= ESCROW_META_GROWTH_PER_MILESTONE_BYTES,
            "{} milestones grew EscrowMeta by {} bytes",
            MAX_MILESTONES,
            growth
        );
        assert_eq!(stored_milestones(&s), MAX_MILESTONES);
    }

    #[test]
    fn bench_max_title_milestone_entry_within_budget() {
        let s = setup();
        let title: std::string::String = "t".repeat(MAX_STRING_LEN as usize);
        let id = add(&s, &title);

        let bytes = milestone_bytes(&s, id).expect("milestone is stored");
        println!(
            "STORAGE_PROFILE | escrow_contract | milestone_entry_max_title | bytes={} | budget={}",
            bytes, MILESTONE_ENTRY_MAX_BYTES
        );
        assert!(
            bytes <= MILESTONE_ENTRY_MAX_BYTES,
            "milestone entry is {} bytes (budget {})",
            bytes,
            MILESTONE_ENTRY_MAX_BYTES
        );
    }

    #[test]
    fn bench_lookup_cost_is_independent_of_position() {
        let s = setup();
        for _ in 0..MAX_MILESTONES {
            add(&s, "m");
        }

        let first = lookup_cpu(&s, 0);
        let last = lookup_cpu(&s, MAX_MILESTONES - 1);
        let spread = first.abs_diff(last);
        println!(
            "STORAGE_PROFILE | escrow_contract | get_milestone | first_cpu={} | last_cpu={} | spread={}",
            first, last, spread
        );

        assert!(
            spread * 100 <= first * MILESTONE_LOOKUP_MAX_COST_SPREAD_PCT,
            "lookup cost spread {} exceeds {}% of {}",
            spread,
            MILESTONE_LOOKUP_MAX_COST_SPREAD_PCT,
            first
        );
    }

    #[test]
    fn bench_lookup_cost_is_independent_of_milestone_count() {
        let s = setup();
        add(&s, "m");
        let with_one = lookup_cpu(&s, 0);
        for _ in 1..MAX_MILESTONES {
            add(&s, "m");
        }
        let with_full = lookup_cpu(&s, 0);

        let spread = with_one.abs_diff(with_full);
        assert!(
            spread * 100 <= with_one * MILESTONE_LOOKUP_MAX_COST_SPREAD_PCT,
            "lookup cost moved from {} to {} as the escrow filled",
            with_one,
            with_full
        );
    }

    // ── Boundary and failure paths ───────────────────────────────────────────

    #[test]
    fn bench_add_past_cap_writes_nothing() {
        let s = setup();
        for _ in 0..MAX_MILESTONES {
            add(&s, "m");
        }
        let before = meta_bytes(&s);

        let result = s.client.try_add_milestone(
            &s.buyer,
            &s.escrow_id,
            &String::from_str(&s.env, "overflow"),
            &BytesN::from_array(&s.env, &[9; 32]),
            &1,
        );

        assert_eq!(result, Err(Ok(EscrowError::E16)));
        assert_eq!(milestone_bytes(&s, MAX_MILESTONES), None);
        assert_eq!(stored_milestones(&s), MAX_MILESTONES);
        assert_eq!(meta_bytes(&s), before);
    }

    #[test]
    fn bench_rejected_batch_writes_nothing() {
        let s = setup();
        add(&s, "m");
        let before = meta_bytes(&s);

        // One more than the remaining capacity: rejected before any write.
        let n = MAX_MILESTONES;
        let mut titles = soroban_sdk::Vec::new(&s.env);
        let mut hashes = soroban_sdk::Vec::new(&s.env);
        let mut amounts = soroban_sdk::Vec::new(&s.env);
        for _ in 0..n {
            titles.push_back(String::from_str(&s.env, "b"));
            hashes.push_back(BytesN::from_array(&s.env, &[1; 32]));
            amounts.push_back(1_i128);
        }
        let result =
            s.client
                .try_batch_add_milestones(&s.buyer, &s.escrow_id, &titles, &hashes, &amounts);

        assert_eq!(result, Err(Ok(EscrowError::E16)));
        assert_eq!(stored_milestones(&s), 1);
        assert_eq!(meta_bytes(&s), before);
    }

    #[test]
    fn bench_out_of_range_lookups_fail_without_scanning() {
        let s = setup();
        add(&s, "m");

        assert_eq!(
            s.client.try_get_milestone(&s.escrow_id, &1),
            Err(Ok(EscrowError::E13))
        );
        assert_eq!(
            s.client.try_get_milestone_by_index(&s.escrow_id, &1),
            Err(Ok(EscrowError::E13))
        );
        assert_eq!(
            s.client.try_get_milestone(&s.escrow_id, &u32::MAX),
            Err(Ok(EscrowError::E13))
        );
        assert_eq!(s.client.get_milestone_by_index(&s.escrow_id, &0).id, 0);
    }
}
