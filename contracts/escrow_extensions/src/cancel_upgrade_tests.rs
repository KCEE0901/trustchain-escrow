//! Caller checks for `cancel_upgrade` (admin only, no numeric arguments).
//!
//! Calls go through the `try_` client so a host panic shows up as
//! `Err(Err(_))` and fails the `Err(Ok(_))` assertions.

#[cfg(test)]
#[allow(clippy::module_inception)]
mod cancel_upgrade_tests {
    use crate::{EscrowExtensions, EscrowExtensionsClient, ExtError};
    use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

    fn setup(init: bool) -> (Env, Address, EscrowExtensionsClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, EscrowExtensions);
        let client = EscrowExtensionsClient::new(&env, &contract_id);
        if init {
            client.initialize(&admin, &0u32);
        }
        (env, admin, client)
    }

    fn queue(env: &Env, admin: &Address, client: &EscrowExtensionsClient<'static>) {
        client.queue_upgrade(admin, &BytesN::from_array(env, &[0xCD; 32]));
    }

    #[test]
    fn test_cancel_upgrade_admin_succeeds() {
        let (env, admin, client) = setup(true);
        queue(&env, &admin, &client);
        assert_eq!(client.try_cancel_upgrade(&admin), Ok(Ok(())));
        assert!(client.get_pending_upgrade().is_none());
    }

    #[test]
    fn test_cancel_upgrade_rejects_other_caller() {
        let (env, admin, client) = setup(true);
        queue(&env, &admin, &client);
        let stranger = Address::generate(&env);
        assert_eq!(
            client.try_cancel_upgrade(&stranger),
            Err(Ok(ExtError::AdminOnly))
        );
        assert!(client.get_pending_upgrade().is_some());
    }

    #[test]
    fn test_cancel_upgrade_without_pending_returns_error() {
        let (_env, admin, client) = setup(true);
        assert_eq!(
            client.try_cancel_upgrade(&admin),
            Err(Ok(ExtError::NoPendingUpgrade))
        );
    }

    #[test]
    fn test_cancel_upgrade_uninitialized_returns_error() {
        let (_env, admin, client) = setup(false);
        assert_eq!(
            client.try_cancel_upgrade(&admin),
            Err(Ok(ExtError::NotInitialized))
        );
    }
}
