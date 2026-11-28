//! Caller and bound checks for `batch_escrow_count`, `open_dispute` and
//! `get_dispute`.
//!
//! None of these entry points take a caller address: `open_dispute` is open to
//! anyone and the other two are read-only. The tests call them without any
//! auth mocked to prove no authorization is required, and exercise `u64`
//! arguments at `0` and `u64::MAX`. Calls go through the `try_` client so a
//! host panic shows up as `Err(Err(_))` and fails the assertions.

#[cfg(test)]
#[allow(clippy::module_inception)]
mod caller_bound_tests {
    use crate::{DataKey, EscrowExtensions, EscrowExtensionsClient, ExtError};
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        Address, Env,
    };

    fn setup() -> (Env, Address, EscrowExtensionsClient<'static>) {
        let env = Env::default();
        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, EscrowExtensions);
        let client = EscrowExtensionsClient::new(&env, &contract_id);
        env.mock_all_auths();
        client.initialize(&admin, &0u32);
        // Drop the mocks so the calls below run with no authorization at all.
        env.set_auths(&[]);
        (env, contract_id, client)
    }

    // ── batch_escrow_count ────────────────────────────────────────────────────

    #[test]
    fn test_batch_escrow_count_needs_no_caller_and_starts_at_zero() {
        let (_env, _id, client) = setup();
        assert_eq!(client.try_batch_escrow_count(), Ok(Ok(0)));
    }

    #[test]
    fn test_batch_escrow_count_returns_max_value_without_panic() {
        let (env, id, client) = setup();
        env.as_contract(&id, || {
            env.storage()
                .instance()
                .set(&DataKey::StorageVersion, &u64::MAX);
        });
        assert_eq!(client.try_batch_escrow_count(), Ok(Ok(u64::MAX)));
    }

    // ── open_dispute ──────────────────────────────────────────────────────────

    #[test]
    fn test_open_dispute_needs_no_caller_for_zero_and_max_id() {
        let (_env, _id, client) = setup();
        for escrow_id in [0u64, u64::MAX] {
            assert_eq!(client.try_open_dispute(&escrow_id), Ok(Ok(())));
            assert_eq!(
                client.try_open_dispute(&escrow_id),
                Err(Ok(ExtError::DisputeAlreadyExists))
            );
        }
    }

    #[test]
    fn test_open_dispute_max_timestamp_returns_overflow_error() {
        let (env, _id, client) = setup();
        env.ledger().with_mut(|l| l.timestamp = u64::MAX);
        assert_eq!(
            client.try_open_dispute(&1u64),
            Err(Ok(ExtError::ArithmeticOverflow))
        );
    }

    // ── get_dispute ───────────────────────────────────────────────────────────

    #[test]
    fn test_get_dispute_missing_zero_and_max_id_return_error() {
        let (_env, _id, client) = setup();
        for escrow_id in [0u64, u64::MAX] {
            let result = client.try_get_dispute(&escrow_id);
            assert!(
                matches!(result, Err(Ok(ExtError::DisputeNotFound))),
                "get_dispute({escrow_id}) must return DisputeNotFound"
            );
        }
    }

    #[test]
    fn test_get_dispute_returns_opened_dispute_for_zero_and_max_id() {
        let (_env, _id, client) = setup();
        for escrow_id in [0u64, u64::MAX] {
            client.open_dispute(&escrow_id);
            let dispute = client.get_dispute(&escrow_id);
            assert_eq!(dispute.escrow_id, escrow_id);
            assert!(!dispute.resolved);
            assert_eq!(dispute.total_stake, 0);
        }
    }
}
