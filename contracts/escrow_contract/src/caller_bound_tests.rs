//! # Caller and bound checks for admin entry points
//!
//! Covers `freeze_escrow`, `unfreeze_escrow` and `set_high_value_threshold`:
//! - the authorized caller succeeds and the success result is unchanged
//! - a different address is rejected with the crate's error, not a panic
//! - numeric arguments at zero and at the type's maximum return an error
//!   (or succeed) instead of panicking
//!
//! Every call goes through the `try_` client so a host panic would surface as
//! `Err(Err(_))` and fail the `Err(Ok(_))` assertions below.

#[cfg(test)]
#[allow(clippy::module_inception)]
mod caller_bound_tests {
    use soroban_sdk::{testutils::Address as _, vec, Address, BytesN, Env};

    use crate::{DataKey, EscrowContract, EscrowContractClient, EscrowError, MultisigConfig};

    const ESCROW_AMOUNT: i128 = 10_000;

    struct Ctx {
        env: Env,
        admin: Address,
        contract_id: Address,
        contract: EscrowContractClient<'static>,
    }

    fn setup() -> Ctx {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &contract_id);
        contract.initialize(&admin);
        Ctx {
            env,
            admin,
            contract_id,
            contract,
        }
    }

    fn no_multisig(env: &Env) -> MultisigConfig {
        MultisigConfig {
            approvers: soroban_sdk::Vec::new(env),
            weights: soroban_sdk::Vec::new(env),
            threshold: 0,
        }
    }

    fn create_escrow(ctx: &Ctx) -> u64 {
        let client_addr = Address::generate(&ctx.env);
        let freelancer = Address::generate(&ctx.env);
        let token_id = ctx
            .env
            .register_stellar_asset_contract_v2(ctx.admin.clone());
        soroban_sdk::token::StellarAssetClient::new(&ctx.env, &token_id.address())
            .mint(&client_addr, &(ESCROW_AMOUNT + 1_000_000));
        ctx.contract.create_escrow(
            &client_addr,
            &freelancer,
            &token_id.address(),
            &ESCROW_AMOUNT,
            &BytesN::from_array(&ctx.env, &[7u8; 32]),
            &None,
            &None,
            &None,
            &None,
            &no_multisig(&ctx.env),
            &None,
        )
    }

    /// Configures a 1-of-1 admin multisig with the contract admin as the signer.
    fn admin_signers(ctx: &Ctx) -> soroban_sdk::Vec<Address> {
        let signers = vec![&ctx.env, ctx.admin.clone()];
        ctx.contract
            .set_admin_multisig(&ctx.admin, &signers, &1u32);
        signers
    }

    fn is_frozen(ctx: &Ctx, escrow_id: u64) -> bool {
        ctx.env.as_contract(&ctx.contract_id, || {
            ctx.env
                .storage()
                .persistent()
                .get(&DataKey::EscrowFrozen(escrow_id))
                .unwrap_or(false)
        })
    }

    // ── freeze_escrow ─────────────────────────────────────────────────────────

    #[test]
    fn test_freeze_escrow_authorized_caller_succeeds() {
        let ctx = setup();
        let id = create_escrow(&ctx);
        let signers = admin_signers(&ctx);

        assert_eq!(ctx.contract.try_freeze_escrow(&id, &signers), Ok(Ok(())));
        assert!(is_frozen(&ctx, id));
    }

    #[test]
    fn test_freeze_escrow_rejects_other_caller() {
        let ctx = setup();
        let id = create_escrow(&ctx);
        admin_signers(&ctx);
        let stranger = vec![&ctx.env, Address::generate(&ctx.env)];

        assert_eq!(
            ctx.contract.try_freeze_escrow(&id, &stranger),
            Err(Ok(EscrowError::E62))
        );
        assert!(!is_frozen(&ctx, id));
    }

    #[test]
    fn test_freeze_escrow_zero_and_max_id_return_error() {
        let ctx = setup();
        create_escrow(&ctx);
        let signers = admin_signers(&ctx);

        for id in [0u64, u64::MAX] {
            let result = ctx.contract.try_freeze_escrow(&id, &signers);
            assert!(
                matches!(result, Err(Ok(_))),
                "freeze_escrow({id}) must return a contract error, got {result:?}"
            );
        }
    }

    // ── unfreeze_escrow ───────────────────────────────────────────────────────

    #[test]
    fn test_unfreeze_escrow_authorized_caller_succeeds() {
        let ctx = setup();
        let id = create_escrow(&ctx);
        let signers = admin_signers(&ctx);
        ctx.contract.freeze_escrow(&id, &signers);

        assert_eq!(ctx.contract.try_unfreeze_escrow(&id, &signers), Ok(Ok(())));
        assert!(!is_frozen(&ctx, id));
    }

    #[test]
    fn test_unfreeze_escrow_rejects_other_caller() {
        let ctx = setup();
        let id = create_escrow(&ctx);
        let signers = admin_signers(&ctx);
        ctx.contract.freeze_escrow(&id, &signers);
        let stranger = vec![&ctx.env, Address::generate(&ctx.env)];

        assert_eq!(
            ctx.contract.try_unfreeze_escrow(&id, &stranger),
            Err(Ok(EscrowError::E62))
        );
        assert!(is_frozen(&ctx, id));
    }

    #[test]
    fn test_unfreeze_escrow_zero_and_max_id_return_error() {
        let ctx = setup();
        create_escrow(&ctx);
        let signers = admin_signers(&ctx);

        for id in [0u64, u64::MAX] {
            let result = ctx.contract.try_unfreeze_escrow(&id, &signers);
            assert!(
                matches!(result, Err(Ok(_))),
                "unfreeze_escrow({id}) must return a contract error, got {result:?}"
            );
        }
    }

    // ── set_high_value_threshold ──────────────────────────────────────────────

    #[test]
    fn test_set_high_value_threshold_authorized_caller_succeeds() {
        let ctx = setup();
        assert_eq!(
            ctx.contract
                .try_set_high_value_threshold(&ctx.admin, &ESCROW_AMOUNT),
            Ok(Ok(()))
        );
        assert_eq!(ctx.contract.get_high_value_threshold(), ESCROW_AMOUNT);
    }

    #[test]
    fn test_set_high_value_threshold_rejects_other_caller() {
        let ctx = setup();
        let stranger = Address::generate(&ctx.env);
        assert_eq!(
            ctx.contract
                .try_set_high_value_threshold(&stranger, &ESCROW_AMOUNT),
            Err(Ok(EscrowError::E4))
        );
    }

    #[test]
    fn test_set_high_value_threshold_zero_returns_error() {
        let ctx = setup();
        assert_eq!(
            ctx.contract.try_set_high_value_threshold(&ctx.admin, &0),
            Err(Ok(EscrowError::MultisigInvalidConfig))
        );
    }

    #[test]
    fn test_set_high_value_threshold_max_value_does_not_panic() {
        let ctx = setup();
        assert_eq!(
            ctx.contract
                .try_set_high_value_threshold(&ctx.admin, &i128::MAX),
            Ok(Ok(()))
        );
        assert_eq!(ctx.contract.get_high_value_threshold(), i128::MAX);
    }
}
