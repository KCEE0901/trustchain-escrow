//! Authorization boundary and determinism tests for reputation scoring
//! (Issue #513).
//!
//! `update_reputation` is the only external path that writes a
//! `ReputationRecord`. It must accept the current admin's authorization for
//! the exact call and reject missing, stale (former / pending admin) and
//! incorrect (wrong signer, wrong arguments) authorization — and scores must
//! be a pure function of the update sequence.

#[cfg(test)]
#[allow(clippy::module_inception)]
mod reputation_auth_tests {
    use soroban_sdk::{
        testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke},
        Address, Env, IntoVal,
    };

    use crate::{EscrowContract, EscrowContractClient, EscrowError};

    fn setup() -> (Env, Address, Address, EscrowContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.initialize(&admin);
        (env, admin, contract_id, client)
    }

    /// Replace all mocked auth with a single signature from `signer`,
    /// covering exactly one `update_reputation` call with these arguments.
    fn authorize_as(
        env: &Env,
        contract_id: &Address,
        signer: &Address,
        subject: &Address,
        completed: bool,
        disputed: bool,
        volume: i128,
    ) {
        env.mock_auths(&[MockAuth {
            address: signer,
            invoke: &MockAuthInvoke {
                contract: contract_id,
                fn_name: "update_reputation",
                args: (subject.clone(), completed, disputed, volume).into_val(env),
                sub_invokes: &[],
            },
        }]);
    }

    fn score_of(client: &EscrowContractClient, address: &Address) -> u64 {
        match client.try_get_reputation(address) {
            Ok(Ok(record)) => record.total_score,
            _ => 0,
        }
    }

    // ── Primary success path ─────────────────────────────────────────────────

    #[test]
    fn current_admin_can_update_reputation() {
        let (env, admin, contract_id, client) = setup();
        let user = Address::generate(&env);

        authorize_as(&env, &contract_id, &admin, &user, true, false, 2_000);
        client.update_reputation(&user, &true, &false, &2_000_i128);

        let record = client.get_reputation(&user);
        assert_eq!(record.total_score, 12);
        assert_eq!(record.completed_escrows, 1);
        assert_eq!(record.total_volume, 2_000);
    }

    // ── Missing authorization ────────────────────────────────────────────────

    #[test]
    fn missing_authorization_is_rejected() {
        let (env, _admin, _contract_id, client) = setup();
        let user = Address::generate(&env);

        env.mock_auths(&[]);
        let result = client.try_update_reputation(&user, &true, &false, &50_000_i128);

        assert!(result.is_err(), "unauthorized update must fail");
        assert_eq!(score_of(&client, &user), 0);
    }

    // ── Incorrect authorization ──────────────────────────────────────────────

    #[test]
    fn non_admin_signer_is_rejected() {
        let (env, _admin, contract_id, client) = setup();
        let user = Address::generate(&env);
        let attacker = Address::generate(&env);

        authorize_as(&env, &contract_id, &attacker, &user, true, false, 50_000);
        assert!(client
            .try_update_reputation(&user, &true, &false, &50_000_i128)
            .is_err());
        assert_eq!(score_of(&client, &user), 0);
    }

    #[test]
    fn subject_cannot_raise_their_own_score() {
        let (env, _admin, contract_id, client) = setup();
        let user = Address::generate(&env);

        authorize_as(&env, &contract_id, &user, &user, true, false, 50_000);
        assert!(client
            .try_update_reputation(&user, &true, &false, &50_000_i128)
            .is_err());
        assert_eq!(score_of(&client, &user), 0);
    }

    #[test]
    fn admin_signature_for_different_arguments_is_rejected() {
        // The admin approved +1_000 volume; replaying that signature with a
        // larger volume (or for another address) must not be accepted.
        let (env, admin, contract_id, client) = setup();
        let user = Address::generate(&env);
        let other = Address::generate(&env);

        authorize_as(&env, &contract_id, &admin, &user, true, false, 1_000);
        assert!(client
            .try_update_reputation(&user, &true, &false, &50_000_i128)
            .is_err());

        authorize_as(&env, &contract_id, &admin, &user, true, false, 1_000);
        assert!(client
            .try_update_reputation(&other, &true, &false, &1_000_i128)
            .is_err());

        assert_eq!(score_of(&client, &user), 0);
        assert_eq!(score_of(&client, &other), 0);
    }

    // ── Stale authorization ──────────────────────────────────────────────────

    #[test]
    fn former_admin_is_rejected_after_transfer() {
        let (env, old_admin, contract_id, client) = setup();
        let new_admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.propose_admin(&old_admin, &new_admin);
        client.accept_admin(&new_admin);

        authorize_as(&env, &contract_id, &old_admin, &user, true, false, 0);
        assert!(client
            .try_update_reputation(&user, &true, &false, &0_i128)
            .is_err());
        assert_eq!(score_of(&client, &user), 0);

        authorize_as(&env, &contract_id, &new_admin, &user, true, false, 0);
        client.update_reputation(&user, &true, &false, &0_i128);
        assert_eq!(score_of(&client, &user), 10);
    }

    #[test]
    fn pending_admin_is_rejected_until_accepted() {
        let (env, admin, contract_id, client) = setup();
        let pending = Address::generate(&env);
        let user = Address::generate(&env);

        client.propose_admin(&admin, &pending);

        authorize_as(&env, &contract_id, &pending, &user, true, false, 0);
        assert!(client
            .try_update_reputation(&user, &true, &false, &0_i128)
            .is_err());
        assert_eq!(score_of(&client, &user), 0);
    }

    // ── Boundaries and determinism ───────────────────────────────────────────

    #[test]
    fn negative_volume_is_rejected_instead_of_wrapping() {
        // Previously `(volume / 1_000) as u64` wrapped a negative bonus to a
        // value near u64::MAX, saturating the score.
        let (env, _admin, _contract_id, client) = setup();
        let user = Address::generate(&env);

        let result = client.try_update_reputation(&user, &true, &false, &-5_000_i128);
        assert_eq!(result, Err(Ok(EscrowError::E17)));
        assert_eq!(score_of(&client, &user), 0);
    }

    #[test]
    fn volume_bonus_is_capped_and_disputes_saturate_at_zero() {
        let (env, _admin, _contract_id, client) = setup();
        let whale = Address::generate(&env);
        let newcomer = Address::generate(&env);

        client.update_reputation(&whale, &true, &false, &1_000_000_i128);
        assert_eq!(score_of(&client, &whale), 20);

        client.update_reputation(&newcomer, &false, &true, &0_i128);
        assert_eq!(score_of(&client, &newcomer), 0);
        assert_eq!(client.get_reputation(&newcomer).disputed_escrows, 1);
    }

    #[test]
    fn identical_update_sequences_yield_identical_scores() {
        let (env, _admin, _contract_id, client) = setup();
        let a = Address::generate(&env);
        let b = Address::generate(&env);

        // (completed, disputed, volume)
        let steps: [(bool, bool, i128); 5] = [
            (true, false, 2_500),
            (false, true, 0),
            (true, false, 999),
            (true, true, 40_000),
            (false, true, 0),
        ];

        for (i, (completed, disputed, volume)) in steps.iter().enumerate() {
            env.ledger().with_mut(|l| l.timestamp = 1_000 + i as u64);
            client.update_reputation(&a, completed, disputed, volume);
        }
        // Same steps for `b`, at different ledger times.
        for (i, (completed, disputed, volume)) in steps.iter().enumerate() {
            env.ledger()
                .with_mut(|l| l.timestamp = 90_000 + 7 * i as u64);
            client.update_reputation(&b, completed, disputed, volume);
        }

        let ra = client.get_reputation(&a);
        let rb = client.get_reputation(&b);
        // 12 → 7 → 17 → 17+20-5=32 → 27
        assert_eq!(ra.total_score, 27);
        assert_eq!(rb.total_score, ra.total_score);
        assert_eq!(rb.completed_escrows, ra.completed_escrows);
        assert_eq!(rb.disputed_escrows, ra.disputed_escrows);
        assert_eq!(rb.total_volume, ra.total_volume);
    }
}
