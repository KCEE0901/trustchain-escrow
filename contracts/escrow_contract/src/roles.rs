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

    #[test]
    fn test_role_enum_equality() {
        assert_eq!(Role::Admin, Role::Admin);
        assert_ne!(Role::Admin, Role::Client);
        assert_ne!(Role::Client, Role::Freelancer);
        assert_ne!(Role::Freelancer, Role::Arbiter);
    }

    #[test]
    fn test_get_role_caller_and_bounds() {
        let env = Env::default();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let arbiter = Address::generate(&env);
        let stranger = Address::generate(&env);

        env.storage().instance().set(&DataKey::Admin, &admin);

        let escrow_id: u64 = 1;
        let meta = crate::types::EscrowMeta {
            client: client.clone(),
            freelancer: freelancer.clone(),
            arbiter: Some(arbiter.clone()),
            ..Default::default()
        };
        ContractStorage::save_escrow_meta(&env, &meta);

        // Known roles resolve to the highest applicable role.
        assert_eq!(
            get_role(&env, &admin, escrow_id),
            Ok(Some(Role::Admin))
        );
        assert_eq!(
            get_role(&env, &client, escrow_id),
            Ok(Some(Role::Client))
        );
        assert_eq!(
            get_role(&env, &freelancer, escrow_id),
            Ok(Some(Role::Freelancer))
        );
        assert_eq!(
            get_role(&env, &arbiter, escrow_id),
            Ok(Some(Role::Arbiter))
        );
        assert_eq!(get_role(&env, &stranger, escrow_id), Ok(None));

        // Numeric bounds: zero and max must not panic.
        let zero_result = get_role(&env, &stranger, 0u64);
        assert!(zero_result.is_ok() || zero_result.is_err());

        let max_result = get_role(&env, &stranger, u64::MAX);
        assert!(max_result.is_ok() || max_result.is_err());

        // Non-existent escrow returns the crate error instead of panicking.
        assert_eq!(get_role(&env, &stranger, 0u64), Err(EscrowError::E1));
        assert_eq!(
            get_role(&env, &stranger, u64::MAX),
            Err(EscrowError::E1)
        );
    }
}
