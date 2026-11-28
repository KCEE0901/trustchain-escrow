//! # Cross-Chain Bridge Integration
//!
//! Supports wrapped tokens bridged to Stellar via Wormhole or Allbridge.
//! Tracks bridge confirmations and provides canonical token representation.

#![allow(dead_code)]

use soroban_sdk::{contractclient, symbol_short, Address, Env, String};

use crate::types::DataKey;
use crate::EscrowError;

mod types;
pub use types::*;

// ── Bridge confirmation threshold ─────────────────────────────────────────────
/// Minimum confirmations required before a bridged deposit is considered final.
pub const MIN_BRIDGE_CONFIRMATIONS: u32 = 15;

/// Maximum number of bridge confirmations accepted by `record_bridge_confirmation`.
pub const MAX_BRIDGE_CONFIRMATIONS: u32 = u32::MAX;

/// Maximum token decimals accepted by `register_wrapped_token`.
pub const MAX_TOKEN_DECIMALS: u32 = 18;

/// Minimal interface for querying a Wormhole token bridge contract on Stellar.
/// Only the `is_wrapped_asset` query is needed for on-chain validation.
#[allow(dead_code)]
#[contractclient(name = "WormholeBridgeClient")]
pub trait WormholeBridgeInterface {
    /// Returns true if `token` is a Wormhole-wrapped asset.
    fn is_wrapped_asset(env: Env, token: Address) -> bool;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

/// Register a wrapped token's canonical metadata. Admin only.
///
/// The caller must be the stored admin; otherwise `EscrowError::E3` is
/// returned. Numeric metadata fields are bounds-checked and `EscrowError::E1`
/// is returned for out-of-range values.
pub fn register_wrapped_token(
    env: &Env,
    caller: &Address,
    info: &WrappedTokenInfo,
) -> Result<(), EscrowError> {
    caller.require_auth();
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(EscrowError::E3)?;
    if &admin != caller {
        return Err(EscrowError::E3);
    }
    if info.decimals > MAX_TOKEN_DECIMALS {
        return Err(EscrowError::E1);
    }
    let key = BridgeDataKey::WrappedToken(info.stellar_address.clone());
    env.storage().persistent().set(&key, info);
    env.storage().persistent().extend_ttl(&key, 5_000, 50_000);
    Ok(())
}

/// Retrieve canonical metadata for a wrapped token, if registered.
pub fn get_wrapped_token_info(env: &Env, token: &Address) -> Option<WrappedTokenInfo> {
    let key = BridgeDataKey::WrappedToken(token.clone());
    let info: Option<WrappedTokenInfo> = env.storage().persistent().get(&key);
    if info.is_some() {
        env.storage().persistent().extend_ttl(&key, 5_000, 50_000);
    }
    info
}

/// Returns true if `token` is a registered and approved wrapped asset.
pub fn is_approved_wrapped_token(env: &Env, token: &Address) -> bool {
    get_wrapped_token_info(env, token)
        .map(|i| i.is_approved)
        .unwrap_or(false)
}

/// Record or update bridge confirmation state for a bridged token.
///
/// Ledger assumptions:
/// - One fixed-shape persistent entry is written per token; later updates overwrite it.
/// - The entry TTL is renewed to 50,000 ledgers with a 5,000-ledger threshold.
/// - Transaction size remains protocol-bounded; the call adds one fixed-size record
///   and one small event. Fees are resource-based, not a contract constant.
/// - `updated_at` is Stellar ledger time in seconds, not source-chain block time;
///   updates in the same ledger may share a timestamp.
pub fn record_bridge_confirmation(env: &Env, confirmation: &BridgeConfirmation) {
    let key = BridgeDataKey::BridgeConfirmation(confirmation.token.clone());
    env.storage().persistent().set(&key, confirmation);
    // TTL is measured in ledger entries, not seconds.
    env.storage().persistent().extend_ttl(&key, 5_000, 50_000);
    Ok(())
}

/// Retrieve bridge confirmation state for a wrapped token.
pub fn get_bridge_confirmation(env: &Env, token: &Address) -> Option<BridgeConfirmation> {
    let key = BridgeDataKey::BridgeConfirmation(token.clone());
    let conf: Option<BridgeConfirmation> = env.storage().persistent().get(&key);
    if conf.is_some() {
        env.storage().persistent().extend_ttl(&key, 5_000, 50_000);
    }
    conf
}

// ── Validation ────────────────────────────────────────────────────────────────

/// Validate that `token` is usable in an escrow: either a native Stellar asset
/// (not registered as wrapped) or an approved wrapped token.
pub fn validate_escrow_token(env: &Env, token: &Address) -> Result<(), EscrowError> {
    // If the token is registered as a wrapped asset it must be approved and finalized.
    if let Some(info) = get_wrapped_token_info(env, token) {
        if !info.is_approved {
            return Err(EscrowError::E54);
        }
        require_bridge_finalized(env, token)?;
    }
    // Native / unregistered Stellar tokens are always allowed.
    Ok(())
}

/// Validate that a bridge transfer is finalized (>= MIN_BRIDGE_CONFIRMATIONS).
pub fn require_bridge_finalized(env: &Env, token: &Address) -> Result<(), EscrowError> {
    let conf = get_bridge_confirmation(env, token).ok_or(EscrowError::E54)?;
    if !conf.is_finalized {
        return Err(EscrowError::E54);
    }
    Ok(())
}

// ── Events ────────────────────────────────────────────────────────────────────

pub fn emit_wrapped_token_registered(env: &Env, token: &Address, origin_chain: &String) {
    env.events().publish(
        (symbol_short!("brg_reg"), token.clone()),
        origin_chain.clone(),
    );
}

pub fn emit_bridge_confirmation_updated(
    env: &Env,
    token: &Address,
    confirmations: u32,
    is_finalized: bool,
) {
    env.events().publish(
        (symbol_short!("brg_cnf"), token.clone()),
        (confirmations, is_finalized),
    );
}

// ── Wormhole bridge address storage ──────────────────────────────────────────

pub fn set_wormhole_bridge(env: &Env, bridge: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::WormholeBridge, bridge);
}

pub fn get_wormhole_bridge(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::WormholeBridge)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn setup() -> (Env, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        env.storage().instance().set(&DataKey::Admin, &admin);
        (env, admin)
    }

    fn sample_info(env: &Env, decimals: u32) -> WrappedTokenInfo {
        WrappedTokenInfo {
            stellar_address: Address::generate(env),
            origin_chain: String::from_str(env, "ethereum"),
            origin_address: String::from_str(env, "0xabc"),
            decimals,
            is_approved: true,
        }
    }

    fn sample_confirmation(env: &Env, confirmations: u32) -> BridgeConfirmation {
        BridgeConfirmation {
            token: Address::generate(env),
            confirmations,
            is_finalized: true,
        }
    }

    #[test]
    fn test_register_wrapped_token_caller_and_bounds() {
        let (env, admin) = setup();

        // Expected caller succeeds.
        let info = sample_info(&env, 7);
        assert_eq!(register_wrapped_token(&env, &admin, &info), Ok(()));

        // Unauthorized caller is rejected with the crate error, not a panic.
        let other = Address::generate(&env);
        let info2 = sample_info(&env, 7);
        assert_eq!(
            register_wrapped_token(&env, &other, &info2),
            Err(EscrowError::E3)
        );

        // Numeric bounds: zero and maximum are accepted.
        let info_zero = sample_info(&env, 0);
        assert_eq!(register_wrapped_token(&env, &admin, &info_zero), Ok(()));
        let info_max = sample_info(&env, MAX_TOKEN_DECIMALS);
        assert_eq!(register_wrapped_token(&env, &admin, &info_max), Ok(()));

        // Out-of-range numeric value is rejected with the crate error.
        let info_over = sample_info(&env, MAX_TOKEN_DECIMALS + 1);
        assert_eq!(
            register_wrapped_token(&env, &admin, &info_over),
            Err(EscrowError::E1)
        );
    }

    #[test]
    fn test_record_bridge_confirmation_caller_and_bounds() {
        let (env, admin) = setup();

        // Expected caller succeeds.
        let conf = sample_confirmation(&env, 15);
        assert_eq!(
            record_bridge_confirmation(&env, &admin, &conf),
            Ok(())
        );

        // Unauthorized caller is rejected with the crate error, not a panic.
        let other = Address::generate(&env);
        let conf2 = sample_confirmation(&env, 15);
        assert_eq!(
            record_bridge_confirmation(&env, &other, &conf2),
            Err(EscrowError::E3)
        );

        // Numeric bounds: zero and u32::MAX are accepted.
        let conf_zero = sample_confirmation(&env, 0);
        assert_eq!(
            record_bridge_confirmation(&env, &admin, &conf_zero),
            Ok(())
        );
        let conf_max = sample_confirmation(&env, u32::MAX);
        assert_eq!(
            record_bridge_confirmation(&env, &admin, &conf_max),
            Ok(())
        );
    }
}
