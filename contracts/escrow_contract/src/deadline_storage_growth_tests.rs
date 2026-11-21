//! # Deadline Auto-Cancellation — Storage-Growth Benchmark
//!
//! `trigger_expiry` cancels an expired escrow by rewriting its `EscrowMeta`
//! entry in place. These benchmarks hold it to the budget in `types.rs`:
//!
//! - the meta entry grows by at most `DEADLINE_AUTO_CANCEL_MAX_META_GROWTH_BYTES`;
//! - milestone entries are neither rewritten nor added;
//! - the cost is the same for an escrow with no milestones and one at
//!   `MAX_MILESTONES`, within `DEADLINE_AUTO_CANCEL_MAX_COST_SPREAD_PCT`;
//! - rejected calls (before the deadline, or on an already cancelled escrow)
//!   write nothing.
//!
//! Each benchmark prints a line for trend tracking:
//!   STORAGE_PROFILE | escrow_contract | <workload> | ...

#[cfg(test)]
#[allow(clippy::module_inception)]
mod deadline_storage_growth_tests {
    extern crate std;

    use std::println;
    use std::vec::Vec as StdVec;

    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        token,
        xdr::ToXdr,
        Address, BytesN, Env, String, Vec,
    };

    use crate::types::{
        DEADLINE_AUTO_CANCEL_MAX_COST_SPREAD_PCT, DEADLINE_AUTO_CANCEL_MAX_META_GROWTH_BYTES,
    };
    use crate::{
        EscrowContract, EscrowContractClient, EscrowError, EscrowMeta, EscrowStatus, Milestone,
        MultisigConfig, PackedDataKey, MAX_MILESTONES,
    };

    const TOTAL: i128 = 2_000;
    const DEADLINE: u64 = 1_100;

    struct Setup {
        env: Env,
        contract_id: Address,
        contract: EscrowContractClient<'static>,
        client: Address,
        keeper: Address,
        escrow_id: u64,
    }

    /// An escrow funded with `TOTAL`, a deadline at `DEADLINE`, and
    /// `milestones` milestones splitting the total evenly.
    fn setup(milestones: u32) -> Setup {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000);
        let admin = Address::generate(&env);
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let contract_id = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &contract_id);
        contract.initialize(&admin);

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        // Extra covers the rent reserve charged on each storage write.
        token::StellarAssetClient::new(&env, &token_id).mint(&client, &(TOTAL + 1_000_000));

        let escrow_id = contract.create_escrow(
            &client,
            &freelancer,
            &token_id,
            &TOTAL,
            &BytesN::from_array(&env, &[3; 32]),
            &None,
            &Some(DEADLINE),
            &None,
            &None,
            &MultisigConfig {
                approvers: Vec::new(&env),
                weights: Vec::new(&env),
                threshold: 0,
            },
            &None,
        );
        if milestones > 0 {
            let each = TOTAL / i128::from(milestones);
            for i in 0..milestones {
                contract.add_milestone(
                    &client,
                    &escrow_id,
                    &String::from_str(&env, "milestone"),
                    &BytesN::from_array(&env, &[i as u8; 32]),
                    &each,
                );
            }
        }

        Setup {
            keeper: Address::generate(&env),
            env,
            contract_id,
            contract,
            client,
            escrow_id,
        }
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

    /// XDR of every milestone slot up to one past the cap (`None` if absent),
    /// so both rewrites and stray new entries are caught.
    fn milestone_snapshot(s: &Setup) -> StdVec<Option<soroban_sdk::Bytes>> {
        s.env.as_contract(&s.contract_id, || {
            (0..=MAX_MILESTONES)
                .map(|id| {
                    s.env
                        .storage()
                        .persistent()
                        .get::<_, Milestone>(&PackedDataKey::Milestone(s.escrow_id, id))
                        .map(|m| m.to_xdr(&s.env))
                })
                .collect()
        })
    }

    fn expire(s: &Setup) -> i128 {
        s.env.ledger().set_timestamp(DEADLINE + 1);
        s.contract.trigger_expiry(&s.keeper, &s.escrow_id)
    }

    fn expiry_cpu(milestones: u32) -> u64 {
        let s = setup(milestones);
        s.env.ledger().set_timestamp(DEADLINE + 1);
        s.env.budget().reset_default();
        s.contract.trigger_expiry(&s.keeper, &s.escrow_id);
        s.env.budget().cpu_instruction_cost()
    }

    // ── Primary path ─────────────────────────────────────────────────────────

    #[test]
    fn bench_auto_cancel_meta_growth_within_budget() {
        let s = setup(0);
        let before = meta_bytes(&s);

        assert_eq!(expire(&s), TOTAL);

        let after = meta_bytes(&s);
        println!(
            "STORAGE_PROFILE | escrow_contract | deadline_auto_cancel | meta_before={} meta_after={} budget_growth={}",
            before, after, DEADLINE_AUTO_CANCEL_MAX_META_GROWTH_BYTES
        );
        assert!(
            after <= before + DEADLINE_AUTO_CANCEL_MAX_META_GROWTH_BYTES,
            "meta grew from {} to {} bytes, budget is {}",
            before,
            after,
            DEADLINE_AUTO_CANCEL_MAX_META_GROWTH_BYTES
        );
        let state = s.contract.get_escrow(&s.escrow_id);
        assert_eq!(state.status, EscrowStatus::Cancelled);
        assert_eq!(state.remaining_balance, 0);
    }

    #[test]
    fn bench_auto_cancel_leaves_milestone_entries_untouched() {
        let s = setup(3);
        let before = milestone_snapshot(&s);
        assert_eq!(before.iter().filter(|m| m.is_some()).count(), 3);

        expire(&s);

        assert_eq!(milestone_snapshot(&s), before);
    }

    #[test]
    fn bench_auto_cancel_cost_independent_of_milestone_count() {
        let empty = expiry_cpu(0);
        let full = expiry_cpu(MAX_MILESTONES);
        let spread_pct = empty.abs_diff(full) * 100 / empty.min(full).max(1);
        println!(
            "STORAGE_PROFILE | escrow_contract | deadline_auto_cancel_cost | cpu_0={} cpu_{}={} spread_pct={} budget_pct={}",
            empty, MAX_MILESTONES, full, spread_pct, DEADLINE_AUTO_CANCEL_MAX_COST_SPREAD_PCT
        );
        assert!(
            spread_pct <= DEADLINE_AUTO_CANCEL_MAX_COST_SPREAD_PCT,
            "auto-cancel cost spread {}% exceeds budget {}%",
            spread_pct,
            DEADLINE_AUTO_CANCEL_MAX_COST_SPREAD_PCT
        );
    }

    // ── Failure and boundary paths ───────────────────────────────────────────

    #[test]
    fn bench_rejected_before_deadline_writes_nothing() {
        let s = setup(2);
        let meta_before = meta_bytes(&s);
        let milestones_before = milestone_snapshot(&s);

        // The deadline itself is not yet expired.
        s.env.ledger().set_timestamp(DEADLINE);
        assert!(matches!(
            s.contract.try_trigger_expiry(&s.keeper, &s.escrow_id),
            Err(Ok(EscrowError::E3))
        ));

        assert_eq!(meta_bytes(&s), meta_before);
        assert_eq!(milestone_snapshot(&s), milestones_before);
        assert_eq!(
            s.contract.get_escrow(&s.escrow_id).status,
            EscrowStatus::Active
        );
    }

    #[test]
    fn bench_repeat_after_cancel_writes_nothing() {
        let s = setup(0);
        expire(&s);
        let meta_after_cancel = meta_bytes(&s);
        let client_balance = token::Client::new(&s.env, &s.contract.get_escrow(&s.escrow_id).token)
            .balance(&s.client);

        assert!(matches!(
            s.contract.try_trigger_expiry(&s.keeper, &s.escrow_id),
            Err(Ok(EscrowError::E9))
        ));

        assert_eq!(meta_bytes(&s), meta_after_cancel);
        assert_eq!(
            token::Client::new(&s.env, &s.contract.get_escrow(&s.escrow_id).token)
                .balance(&s.client),
            client_balance
        );
    }
}
