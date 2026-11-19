use soroban_sdk::{Address, Env, Vec};

use crate::errors::EscrowError;
use crate::storage::ContractStorage;
use crate::types::{DataKey, EscrowStatus, StateHistoryEntry};

pub fn record_state_change(
    env: &Env,
    escrow_id: u64,
    from_status: EscrowStatus,
    to_status: EscrowStatus,
    caller: &Address,
) -> Result<(), EscrowError> {
    // Validate escrow_id bounds: reject zero.
    if escrow_id == 0 {
        return Err(EscrowError::E1);
    }

    // Validate caller: require authorization from the caller.
    caller.require_auth();

    let key = DataKey::StateHistory(escrow_id);
    let now = env.ledger().timestamp();
    let entry = StateHistoryEntry {
        escrow_id,
        from_status,
        to_status,
        timestamp: now,
        caller: caller.clone(),
    };
    let mut history: Vec<StateHistoryEntry> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(Vec::new);
    history.push_back(entry);
    env.storage().persistent().set(&key, &history);
    ContractStorage::bump_persistent_ttl(env, &key);

    Ok(())
}

pub fn get_state_history(env: &Env, escrow_id: u64) -> Vec<StateHistoryEntry> {
    let key = DataKey::StateHistory(escrow_id);
    match env.storage().persistent().get(&key) {
        Some(history) => {
            ContractStorage::bump_persistent_ttl(env, &key);
            history
        }
        None => Vec::new(env),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    #[test]
    fn test_record_state_change_caller_and_bounds() {
        let env = Env::default();
        env.mock_all_auths();

        let caller = Address::generate(&env);
        let other = Address::generate(&env);

        // Expected caller with a valid escrow_id should succeed.
        let result = record_state_change(
            &env,
            1,
            EscrowStatus::Pending,
            EscrowStatus::Active,
            &caller,
        );
        assert_eq!(result, Ok(()));

        // A different caller is still authorized under mock_all_auths, but the
        // call must not panic and must return Ok.
        let result = record_state_change(
            &env,
            2,
            EscrowStatus::Pending,
            EscrowStatus::Active,
            &other,
        );
        assert_eq!(result, Ok(()));

        // escrow_id = 0 must be rejected with an error, not a panic.
        let result = record_state_change(
            &env,
            0,
            EscrowStatus::Pending,
            EscrowStatus::Active,
            &caller,
        );
        assert_eq!(result, Err(EscrowError::E1));

        // escrow_id = u64::MAX must not panic; it is a valid bound.
        let result = record_state_change(
            &env,
            u64::MAX,
            EscrowStatus::Pending,
            EscrowStatus::Active,
            &caller,
        );
        assert_eq!(result, Ok(()));
    }

    #[test]
    fn test_record_state_change_unauthorized_caller() {
        let env = Env::default();
        // Do not mock auths: require_auth will fail for an unauthorized caller.
        let caller = Address::generate(&env);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            record_state_change(
                &env,
                1,
                EscrowStatus::Pending,
                EscrowStatus::Active,
                &caller,
            )
        }));

        // The call must not silently succeed without authorization.
        match result {
            Ok(res) => assert!(res.is_err()),
            Err(_) => {
                // A panic from require_auth is acceptable in the unauthorized
                // path; the important guarantee is that it does not succeed.
            }
        }
    }
}