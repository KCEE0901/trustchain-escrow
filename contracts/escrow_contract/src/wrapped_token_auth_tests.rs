//! # Wrapped Token Registry — Authorization Boundary Tests
//!
//! Every privileged registry path (`register_wrapped_token`,
//! `set_wormhole_bridge`) must accept the current admin and reject:
//! - a missing signature from the admin,
//! - a stale admin that has handed the role over,
//! - an incorrect caller that was never admin,
//! - any caller before the contract is initialized.
//!
//! A rejected call must leave the registry exactly as it was.

#[cfg(test)]
#[allow(clippy::module_inception)]
mod wrapped_token_auth_tests {
    use soroban_sdk::{testutils::Address as _, Address, Env, String};

    use crate::bridge::{BridgeProtocol, WrappedTokenInfo};
    use crate::types::DataKey;
    use crate::{EscrowContract, EscrowContractClient, EscrowError};

    fn deploy(env: &Env) -> (Address, EscrowContractClient<'static>) {
        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(env, &contract_id);
        (contract_id, client)
    }

    fn setup() -> (Env, Address, Address, EscrowContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let (contract_id, client) = deploy(&env);
        client.initialize(&admin);
        (env, admin, contract_id, client)
    }

    fn info(env: &Env, token: &Address, is_approved: bool) -> WrappedTokenInfo {
        WrappedTokenInfo {
            stellar_address: token.clone(),
            origin_chain: String::from_str(env, "ethereum"),
            origin_address: String::from_str(env, "0x0000000000000000000000000000000000000001"),
            bridge: BridgeProtocol::Wormhole,
            is_approved,
        }
    }

    fn wormhole_bridge(env: &Env, contract_id: &Address) -> Option<Address> {
        env.as_contract(contract_id, || {
            env.storage().instance().get(&DataKey::WormholeBridge)
        })
    }

    /// Hands the admin role from `admin` to a fresh address and returns it.
    fn rotate_admin(env: &Env, client: &EscrowContractClient, admin: &Address) -> Address {
        let new_admin = Address::generate(env);
        client.propose_admin(admin, &new_admin);
        client.accept_admin(&new_admin);
        assert_eq!(client.get_admin(), new_admin);
        new_admin
    }

    // ── Primary path ─────────────────────────────────────────────────────────

    #[test]
    fn test_admin_registers_wrapped_token_with_own_auth() {
        let (env, admin, _, client) = setup();
        let token = Address::generate(&env);

        client.register_wrapped_token(&admin, &info(&env, &token, true));

        // The admin is the only address whose signature was required.
        let auths = env.auths();
        assert_eq!(auths.len(), 1);
        assert_eq!(auths[0].0, admin);
        assert!(client.get_wrapped_token_info(&token).unwrap().is_approved);
    }

    #[test]
    fn test_admin_sets_wormhole_bridge() {
        let (env, admin, contract_id, client) = setup();
        let bridge = Address::generate(&env);

        client.set_wormhole_bridge(&admin, &bridge);

        assert_eq!(env.auths()[0].0, admin);
        assert_eq!(wormhole_bridge(&env, &contract_id), Some(bridge));
    }

    // ── Missing authorization ────────────────────────────────────────────────

    #[test]
    fn test_register_without_admin_signature_is_rejected() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let (_, client) = deploy(&env);
        client.initialize(&admin);
        let token = Address::generate(&env);

        // No auth is mocked, so the admin's require_auth cannot be satisfied.
        let result = client.try_register_wrapped_token(&admin, &info(&env, &token, true));

        assert!(result.is_err());
        assert!(client.get_wrapped_token_info(&token).is_none());
    }

    #[test]
    fn test_set_bridge_without_admin_signature_is_rejected() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let (contract_id, client) = deploy(&env);
        client.initialize(&admin);

        let result = client.try_set_wormhole_bridge(&admin, &Address::generate(&env));

        assert!(result.is_err());
        assert_eq!(wormhole_bridge(&env, &contract_id), None);
    }

    // ── Stale authorization ──────────────────────────────────────────────────

    #[test]
    fn test_former_admin_cannot_register_after_handover() {
        let (env, old_admin, _, client) = setup();
        let new_admin = rotate_admin(&env, &client, &old_admin);
        let token = Address::generate(&env);

        let result = client.try_register_wrapped_token(&old_admin, &info(&env, &token, true));
        assert_eq!(result, Err(Ok(EscrowError::E4)));
        assert!(client.get_wrapped_token_info(&token).is_none());

        // The new admin holds the role.
        client.register_wrapped_token(&new_admin, &info(&env, &token, true));
        assert!(client.get_wrapped_token_info(&token).is_some());
    }

    #[test]
    fn test_former_admin_cannot_revoke_approval() {
        let (env, old_admin, _, client) = setup();
        let token = Address::generate(&env);
        client.register_wrapped_token(&old_admin, &info(&env, &token, true));
        rotate_admin(&env, &client, &old_admin);

        let result = client.try_register_wrapped_token(&old_admin, &info(&env, &token, false));

        assert_eq!(result, Err(Ok(EscrowError::E4)));
        assert!(client.get_wrapped_token_info(&token).unwrap().is_approved);
    }

    #[test]
    fn test_pending_admin_cannot_register_before_accepting() {
        let (env, admin, _, client) = setup();
        let pending = Address::generate(&env);
        client.propose_admin(&admin, &pending);
        let token = Address::generate(&env);

        let result = client.try_register_wrapped_token(&pending, &info(&env, &token, true));

        assert_eq!(result, Err(Ok(EscrowError::E4)));
        assert!(client.get_wrapped_token_info(&token).is_none());
    }

    #[test]
    fn test_former_admin_cannot_set_wormhole_bridge() {
        let (env, old_admin, contract_id, client) = setup();
        let bridge = Address::generate(&env);
        client.set_wormhole_bridge(&old_admin, &bridge);
        rotate_admin(&env, &client, &old_admin);

        let result = client.try_set_wormhole_bridge(&old_admin, &Address::generate(&env));

        assert_eq!(result, Err(Ok(EscrowError::E4)));
        assert_eq!(wormhole_bridge(&env, &contract_id), Some(bridge));
    }

    // ── Incorrect authorization ──────────────────────────────────────────────

    #[test]
    fn test_non_admin_cannot_register_or_overwrite() {
        let (env, admin, _, client) = setup();
        let impostor = Address::generate(&env);
        let token = Address::generate(&env);

        let result = client.try_register_wrapped_token(&impostor, &info(&env, &token, true));
        assert_eq!(result, Err(Ok(EscrowError::E4)));
        assert!(client.get_wrapped_token_info(&token).is_none());

        // Once registered by the admin, the impostor cannot flip approval.
        client.register_wrapped_token(&admin, &info(&env, &token, false));
        let result = client.try_register_wrapped_token(&impostor, &info(&env, &token, true));
        assert_eq!(result, Err(Ok(EscrowError::E4)));
        assert!(!client.get_wrapped_token_info(&token).unwrap().is_approved);
    }

    #[test]
    fn test_non_admin_cannot_set_wormhole_bridge() {
        let (env, _, contract_id, client) = setup();
        let impostor = Address::generate(&env);

        let result = client.try_set_wormhole_bridge(&impostor, &Address::generate(&env));

        assert_eq!(result, Err(Ok(EscrowError::E4)));
        assert_eq!(wormhole_bridge(&env, &contract_id), None);
    }

    // ── Boundary: uninitialized contract ─────────────────────────────────────

    #[test]
    fn test_registry_is_locked_before_initialize() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, client) = deploy(&env);
        let caller = Address::generate(&env);
        let token = Address::generate(&env);

        let result = client.try_register_wrapped_token(&caller, &info(&env, &token, true));
        assert_eq!(result, Err(Ok(EscrowError::E2)));

        let result = client.try_set_wormhole_bridge(&caller, &Address::generate(&env));
        assert_eq!(result, Err(Ok(EscrowError::E2)));

        assert!(client.get_wrapped_token_info(&token).is_none());
        assert_eq!(wormhole_bridge(&env, &contract_id), None);
    }
}
