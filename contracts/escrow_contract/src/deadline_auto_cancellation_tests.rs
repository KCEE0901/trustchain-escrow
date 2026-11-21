#[cfg(test)]
mod deadline_auto_cancellation_tests {
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        token, Address, BytesN, Env, Vec,
    };

    use crate::{EscrowContract, EscrowContractClient, EscrowError, EscrowStatus, MultisigConfig};

    fn no_multisig(env: &Env) -> MultisigConfig {
        MultisigConfig {
            approvers: Vec::new(env),
            weights: Vec::new(env),
            threshold: 0,
        }
    }

    struct Fixture {
        env: Env,
        contract: EscrowContractClient<'static>,
        token_id: Address,
        client: Address,
        freelancer: Address,
        keeper: Address,
    }

    fn setup() -> Fixture {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000);
        let admin = Address::generate(&env);
        let token_id = env
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
            contract,
            token_id,
        }
    }

    fn create(fixture: &Fixture, deadline: Option<u64>, seed: u8) -> u64 {
        token::StellarAssetClient::new(&fixture.env, &fixture.token_id).mint(&fixture.client, &530);
        fixture.contract.create_escrow(
            &fixture.client,
            &fixture.freelancer,
            &fixture.token_id,
            &500,
            &BytesN::from_array(&fixture.env, &[seed; 32]),
            &None,
            &deadline,
            &None,
            &None,
            &no_multisig(&fixture.env),
            &None,
        )
    }

    #[test]
    fn deadline_transition_refunds_exactly_once_after_boundary() {
        let fixture = setup();
        let escrow_id = create(&fixture, Some(1_100), 1);

        fixture.env.ledger().set_timestamp(1_100);
        assert!(!fixture.contract.is_expired(&escrow_id));
        assert!(matches!(
            fixture
                .contract
                .try_trigger_expiry(&fixture.keeper, &escrow_id),
            Err(Ok(EscrowError::E3))
        ));

        fixture.env.ledger().set_timestamp(1_101);
        assert!(fixture.contract.is_expired(&escrow_id));
        assert_eq!(
            fixture.contract.trigger_expiry(&fixture.keeper, &escrow_id),
            500
        );

        let state = fixture.contract.get_escrow(&escrow_id);
        assert_eq!(state.status, EscrowStatus::Cancelled);
        assert_eq!(state.remaining_balance, 0);
        assert_eq!(
            token::Client::new(&fixture.env, &fixture.token_id).balance(&fixture.client),
            500
        );
        assert!(matches!(
            fixture
                .contract
                .try_trigger_expiry(&fixture.keeper, &escrow_id),
            Err(Ok(EscrowError::E9))
        ));
    }

    #[test]
    fn escrow_without_deadline_never_auto_cancels() {
        let fixture = setup();
        let escrow_id = create(&fixture, None, 2);
        fixture.env.ledger().set_timestamp(u64::MAX - 1);

        assert!(!fixture.contract.is_expired(&escrow_id));
        assert!(matches!(
            fixture
                .contract
                .try_trigger_expiry(&fixture.keeper, &escrow_id),
            Err(Ok(EscrowError::E3))
        ));
        let state = fixture.contract.get_escrow(&escrow_id);
        assert_eq!(state.status, EscrowStatus::Active);
        assert_eq!(state.remaining_balance, 500);
    }
}
