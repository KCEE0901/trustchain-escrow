#![allow(dead_code)]
//! Role-based access control for the escrow contract.
//!
//! Defines roles (Admin, Arbiter, Participant) and provides guards
//! that entry points use to enforce authorization.
//!
//! Closes #100

use soroban_sdk::{Address, Env};

use crate::errors::EscrowError;
use crate::events;
use crate::ContractStorage;
use crate::types::DataKey;

/// Roles recognized by the escrow contract.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Role {
    /// Contract-level administrator.
    Admin,
    /// Arbiter assigned to a specific escrow.
    Arbiter,
    /// Client (buyer) of a specific escrow.
    Client,
    /// Freelancer (seller) of a specific escrow.
    Freelancer,
    /// Any participant (client, freelancer, or arbiter) of a specific escrow.
    Participant,
}

/// Require that `caller` is the stored contract admin.
pub fn require_admin(env: &Env, caller: &Address) -> Result<(), EscrowError> {
    caller.require_auth();
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(EscrowError::E2)?;
    if caller != &admin {
        return Err(EscrowError::E3);
    }
    Ok(())
}

/// Require that `caller` is the client of the given escrow.
pub fn require_client(
    env: &Env,
    caller: &Address,
    escrow_id: u64,
) -> Result<(), EscrowError> {
    caller.require_auth();
    let meta = ContractStorage::load_escrow_meta(env, escrow_id)?;
    if caller != &meta.client {
        return Err(EscrowError::E5);
    }
    Ok(())
}

/// Require that `caller` is the freelancer of the given escrow.
pub fn require_freelancer(
    env: &Env,
    caller: &Address,
    escrow_id: u64,
) -> Result<(), EscrowError> {
    caller.require_auth();
    let meta = ContractStorage::load_escrow_meta(env, escrow_id)?;
    if caller != &meta.freelancer {
        return Err(EscrowError::E3);
    }
    Ok(())
}

/// Require that `caller` is the arbiter of the given escrow.
pub fn require_arbiter(
    env: &Env,
    caller: &Address,
    escrow_id: u64,
) -> Result<(), EscrowError> {
    caller.require_auth();
    let meta = ContractStorage::load_escrow_meta(env, escrow_id)?;
    match &meta.arbiter {
        Some(arb) if arb == caller => Ok(()),
        _ => Err(EscrowError::E3),
    }
}

/// Require that `caller` is a participant (client, freelancer, or arbiter).
pub fn require_participant(
    env: &Env,
    caller: &Address,
    escrow_id: u64,
) -> Result<(), EscrowError> {
    caller.require_auth();
    let meta = ContractStorage::load_escrow_meta(env, escrow_id)?;
    let is_participant = caller == &meta.client
        || caller == &meta.freelancer
        || meta.arbiter.as_ref() == Some(caller);
    if !is_participant {
        return Err(EscrowError::E3);
    }
    Ok(())
}

/// Check the role of an address for a given escrow. Returns the highest
/// applicable role, or `None` if the address has no role.
pub fn get_role(
    env: &Env,
    address: &Address,
    escrow_id: u64,
) -> Result<Option<Role>, EscrowError> {
    // Check admin first (contract-level role).
    if let Some(admin) = env.storage().instance().get::<_, Address>(&DataKey::Admin) {
        if address == &admin {
            return Ok(Some(Role::Admin));
        }
    }
    let meta = ContractStorage::load_escrow_meta(env, escrow_id)?;
    if address == &meta.client {
        return Ok(Some(Role::Client));
    }
    if address == &meta.freelancer {
        return Ok(Some(Role::Freelancer));
    }
    if meta.arbiter.as_ref() == Some(address) {
        return Ok(Some(Role::Arbiter));
    }
    Ok(None)
}

/// Assign an arbiter to an escrow. Only the admin or client may do this.
pub fn assign_arbiter(
    env: &Env,
    caller: &Address,
    escrow_id: u64,
    new_arbiter: &Address,
) -> Result<(), EscrowError> {
    caller.require_auth();
    ContractStorage::require_not_paused(env)?;
    let mut meta = ContractStorage::load_escrow_meta(env, escrow_id)?;

    // Only admin or client may assign arbiter
    let admin: Option<Address> = env.storage().instance().get(&DataKey::Admin);
    if Some(caller.clone()) != admin && caller != &meta.client {
        return Err(EscrowError::E3);
    }

    // Arbiter cannot be client or freelancer
    if new_arbiter == &meta.client || new_arbiter == &meta.freelancer {
        return Err(EscrowError::E3);
    }

    meta.arbiter = Some(new_arbiter.clone());
    ContractStorage::save_escrow_meta(env, &meta);
    events::emit_arbiter_updated(env, escrow_id, &Some(new_arbiter.clone()));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    #[test]
    fn test_role_enum_equality() {
        assert_eq!(Role::Admin, Role::Admin);
        assert_ne!(Role::Admin, Role::Client);
        assert_ne!(Role::Client, Role::Freelancer);
        assert_ne!(Role::Freelancer, Role::Arbiter);
    }

    /// Build a test environment with an escrow containing a client,
    /// freelancer, and arbiter, plus a separate admin.
    fn setup_escrow(
        env: &Env,
        escrow_id: u64,
    ) -> (Address, Address, Address, Address) {
        let admin = Address::generate(env);
        let client = Address::generate(env);
        let freelancer = Address::generate(env);
        let arbiter = Address::generate(env);

        env.storage().instance().set(&DataKey::Admin, &admin);

        let meta = crate::types::EscrowMeta {
            client: client.clone(),
            freelancer: freelancer.clone(),
            arbiter: Some(arbiter.clone()),
            ..Default::default()
        };
        ContractStorage::save_escrow_meta(env, &meta);

        (admin, client, freelancer, arbiter)
    }

    #[test]
    fn test_require_participant_accepts_participants() {
        let env = Env::default();
        env.mock_all_auths();
        let (_admin, client, freelancer, arbiter) = setup_escrow(&env, 1);

        assert_eq!(require_participant(&env, &client, 1), Ok(()));
        assert_eq!(require_participant(&env, &freelancer, 1), Ok(()));
        assert_eq!(require_participant(&env, &arbiter, 1), Ok(()));
    }

    #[test]
    fn test_require_participant_rejects_non_participant() {
        let env = Env::default();
        env.mock_all_auths();
        let (_admin, _client, _freelancer, _arbiter) = setup_escrow(&env, 1);
        let outsider = Address::generate(&env);

        assert_eq!(
            require_participant(&env, &outsider, 1),
            Err(EscrowError::E3)
        );
    }

    #[test]
    fn test_require_participant_bounds_escrow_id() {
        let env = Env::default();
        env.mock_all_auths();
        let (_admin, client, _freelancer, _arbiter) = setup_escrow(&env, 0);

        // escrow_id at zero: participant succeeds, outsider rejected.
        assert_eq!(require_participant(&env, &client, 0), Ok(()));
        let outsider = Address::generate(&env);
        assert_eq!(
            require_participant(&env, &outsider, 0),
            Err(EscrowError::E3)
        );

        // escrow_id at u64::MAX: missing escrow returns typed error, no panic.
        let result = require_participant(&env, &client, u64::MAX);
        assert!(result.is_err());
    }

    #[test]
    fn test_assign_arbiter_admin_and_client_succeed() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, client, _freelancer, _arbiter) = setup_escrow(&env, 1);

        let new_arbiter = Address::generate(&env);
        assert_eq!(assign_arbiter(&env, &admin, 1, &new_arbiter), Ok(()));

        let new_arbiter2 = Address::generate(&env);
        assert_eq!(assign_arbiter(&env, &client, 1, &new_arbiter2), Ok(()));
    }

    #[test]
    fn test_assign_arbiter_rejects_unauthorized_caller() {
        let env = Env::default();
        env.mock_all_auths();
        let (_admin, _client, freelancer, _arbiter) = setup_escrow(&env, 1);

        let new_arbiter = Address::generate(&env);
        assert_eq!(
            assign_arbiter(&env, &freelancer, 1, &new_arbiter),
            Err(EscrowError::E3)
        );
    }

    #[test]
    fn test_assign_arbiter_bounds_escrow_id() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, _client, _freelancer, _arbiter) = setup_escrow(&env, 0);

        // escrow_id at zero: admin succeeds.
        let new_arbiter = Address::generate(&env);
        assert_eq!(assign_arbiter(&env, &admin, 0, &new_arbiter), Ok(()));

        // escrow_id at u64::MAX: missing escrow returns typed error, no panic.
        let new_arbiter2 = Address::generate(&env);
        let result = assign_arbiter(&env, &admin, u64::MAX, &new_arbiter2);
        assert!(result.is_err());
    }
}
