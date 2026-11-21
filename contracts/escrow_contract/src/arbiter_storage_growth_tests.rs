//! # Arbiter Selection Lifecycle — Storage-Growth Benchmark
//!
//! Measures the persistent footprint of selecting, replacing and removing an
//! arbiter and holds it to the budget in `types.rs`:
//!
//! - selecting an arbiter grows `EscrowMeta` by at most
//!   `ARBITER_SELECTION_MAX_META_GROWTH_BYTES`;
//! - any number of replacements or removals never grows it further
//!   (`ARBITER_UPDATE_MAX_META_GROWTH_BYTES`);
//! - no other persistent entry is written for the arbiter.
//!
//! Each benchmark prints a line for trend tracking:
//!   STORAGE_PROFILE | escrow_contract | <workload> | meta_bytes=<n> | ...

#[cfg(test)]
#[allow(clippy::module_inception)]
mod arbiter_storage_growth_tests {
    extern crate std;

    use std::println;

    use soroban_sdk::{testutils::Address as _, token, xdr::ToXdr, Address, BytesN, Env};

    use crate::types::{
        DataKey, ARBITER_SELECTION_MAX_META_GROWTH_BYTES, ARBITER_UPDATE_MAX_META_GROWTH_BYTES,
    };
    use crate::{
        EscrowContract, EscrowContractClient, EscrowError, EscrowMeta, MultisigConfig,
        PackedDataKey,
    };

    /// Replacement rounds in the realistic workload: an escrow whose arbiter
    /// is swapped far more often than any real agreement would need.
    const REPLACEMENT_ROUNDS: u32 = 25;

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
            &BytesN::from_array(&s.env, &[3; 32]),
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

    /// XDR size of the persisted `EscrowMeta` entry, as written to the ledger.
    fn meta_bytes(s: &Setup, escrow_id: u64) -> u32 {
        s.env.as_contract(&s.contract_id, || {
            let meta: EscrowMeta = s
                .env
                .storage()
                .persistent()
                .get(&PackedDataKey::EscrowMeta(escrow_id))
                .expect("escrow meta is stored");
            meta.to_xdr(&s.env).len()
        })
    }

    /// True if the contract keeps a participant index entry for `address`.
    fn has_participant_index(s: &Setup, address: &Address) -> bool {
        s.env.as_contract(&s.contract_id, || {
            s.env
                .storage()
                .persistent()
                .has(&DataKey::EscrowsByParticipant(address.clone()))
        })
    }

    fn profile(workload: &str, meta_bytes: u32, growth: u32, budget: u32) {
        println!(
            "STORAGE_PROFILE | escrow_contract | {} | meta_bytes={} | growth={} | budget={}",
            workload, meta_bytes, growth, budget
        );
    }

    // ── Primary path ─────────────────────────────────────────────────────────

    #[test]
    fn bench_arbiter_selection_growth_within_budget() {
        let s = setup();
        let without = create_escrow(&s, None);
        let with = create_escrow(&s, Some(Address::generate(&s.env)));

        let base = meta_bytes(&s, without);
        let selected = meta_bytes(&s, with);
        let growth = selected.saturating_sub(base);
        profile(
            "create_with_arbiter",
            selected,
            growth,
            ARBITER_SELECTION_MAX_META_GROWTH_BYTES,
        );

        assert!(
            selected > base,
            "the arbiter must be persisted in EscrowMeta"
        );
        assert!(
            growth <= ARBITER_SELECTION_MAX_META_GROWTH_BYTES,
            "selecting an arbiter grew EscrowMeta by {} bytes (budget {})",
            growth,
            ARBITER_SELECTION_MAX_META_GROWTH_BYTES
        );

        // Selecting later through update_arbiter costs the same as at creation.
        s.client
            .update_arbiter(&without, &Some(Address::generate(&s.env)));
        assert_eq!(meta_bytes(&s, without), selected);
    }

    #[test]
    fn bench_repeated_replacement_does_not_grow_storage() {
        let s = setup();
        let escrow_id = create_escrow(&s, Some(Address::generate(&s.env)));
        let baseline = meta_bytes(&s, escrow_id);

        let mut peak = baseline;
        for _ in 0..REPLACEMENT_ROUNDS {
            s.client
                .update_arbiter(&escrow_id, &Some(Address::generate(&s.env)));
            peak = peak.max(meta_bytes(&s, escrow_id));
        }
        let growth = peak - baseline;
        profile(
            "replace_arbiter_x25",
            peak,
            growth,
            ARBITER_UPDATE_MAX_META_GROWTH_BYTES,
        );

        assert!(
            growth <= ARBITER_UPDATE_MAX_META_GROWTH_BYTES,
            "{} replacements grew EscrowMeta by {} bytes",
            REPLACEMENT_ROUNDS,
            growth
        );
    }

    // ── Boundary paths ───────────────────────────────────────────────────────

    #[test]
    fn bench_removing_arbiter_releases_its_bytes() {
        let s = setup();
        let reference = create_escrow(&s, None);
        let escrow_id = create_escrow(&s, Some(Address::generate(&s.env)));

        s.client.update_arbiter(&escrow_id, &None);
        let after = meta_bytes(&s, escrow_id);
        profile(
            "remove_arbiter",
            after,
            0,
            ARBITER_UPDATE_MAX_META_GROWTH_BYTES,
        );

        assert_eq!(after, meta_bytes(&s, reference));
    }

    #[test]
    fn bench_arbiters_get_no_index_entries() {
        let s = setup();
        let first = Address::generate(&s.env);
        let second = Address::generate(&s.env);
        let escrow_id = create_escrow(&s, Some(first.clone()));
        s.client.update_arbiter(&escrow_id, &Some(second.clone()));

        // Parties are indexed; arbiters are not, so the lifecycle writes only
        // the EscrowMeta entry and its footprint stays O(1) per escrow.
        assert!(has_participant_index(&s, &s.buyer));
        assert!(!has_participant_index(&s, &first));
        assert!(!has_participant_index(&s, &second));
    }

    #[test]
    fn bench_rejected_update_writes_nothing() {
        let s = setup();
        let escrow_id = create_escrow(&s, None);
        let before = meta_bytes(&s, escrow_id);

        let result = s
            .client
            .try_update_arbiter(&escrow_id, &Some(s.buyer.clone()));
        assert_eq!(result, Err(Ok(EscrowError::E3)));
        assert_eq!(meta_bytes(&s, escrow_id), before);
        assert_eq!(s.client.get_escrow(&escrow_id).arbiter, None);
    }
}
