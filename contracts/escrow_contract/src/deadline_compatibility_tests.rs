#[cfg(test)]
mod deadline_compatibility_tests {
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        token, Address, Bytes, BytesN, Env, Vec,
    };

    use crate::{EscrowContract, EscrowContractClient, EscrowStatus, MultisigConfig};

    const MINIMAL_WASM: &[u8] = &[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

    fn no_multisig(env: &Env) -> MultisigConfig {
        MultisigConfig {
            approvers: Vec::new(env),
            weights: Vec::new(env),
            threshold: 0,
        }
    }

    struct Fixture {
        env: Env,
        admin: Address,
        client: Address,
        freelancer: Address,
        keeper: Address,
        token: Address,
        contract: EscrowContractClient<'static>,
    }

    fn setup(timestamp: u64) -> Fixture {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(timestamp);
        let admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let contract_id = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &contract_id);
        contract.initialize(&admin);
        Fixture {
            client: Address::generate(&env),
            freelancer: Address::generate(&env),
            keeper: Address::generate(&env),
            env,
            admin,
            token,
            contract,
        }
    }

    fn create(fixture: &Fixture, deadline: u64, seed: u8) -> u64 {
        token::StellarAssetClient::new(&fixture.env, &fixture.token).mint(&fixture.client, &530);
        fixture.contract.create_escrow(
            &fixture.client,
            &fixture.freelancer,
            &fixture.token,
            &500,
            &BytesN::from_array(&fixture.env, &[seed; 32]),
            &None,
            &Some(deadline),
            &None,
            &None,
            &no_multisig(&fixture.env),
            &None,
        )
    }

    #[test]
    fn fuzz_deadline_boundary_is_strict_and_deterministic() {
        let mut state = 0xD3AD_11AE_u64;
        for seed in 1_u8..=32 {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            let now = 1_000 + state % 10_000;
            let offset = 1 + state % 86_400;
            let deadline = now + offset;
            let fixture = setup(now);
            let escrow_id = create(&fixture, deadline, seed);

            fixture.env.ledger().set_timestamp(deadline);
            assert!(!fixture.contract.is_expired(&escrow_id));
            fixture.env.ledger().set_timestamp(deadline + 1);
            assert!(fixture.contract.is_expired(&escrow_id));
        }
    }

    #[test]
    fn upgrade_preserves_deadline_and_auto_cancellation_api() {
        let fixture = setup(1_000);
        let escrow_id = create(&fixture, 1_100, 77);
        let wasm_hash = fixture
            .env
            .deployer()
            .upload_contract_wasm(Bytes::from_slice(&fixture.env, MINIMAL_WASM));

        fixture.contract.upgrade(&fixture.admin, &wasm_hash);
        assert_eq!(
            fixture.contract.get_escrow(&escrow_id).deadline,
            Some(1_100)
        );

        fixture.env.ledger().set_timestamp(1_101);
        assert_eq!(
            fixture.contract.trigger_expiry(&fixture.keeper, &escrow_id),
            500
        );
        let state = fixture.contract.get_escrow(&escrow_id);
        assert_eq!(state.status, EscrowStatus::Cancelled);
        assert_eq!(state.remaining_balance, 0);
    }
}
