use criterion::{criterion_group, criterion_main, BatchSize, Criterion};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Address, Env, String};
use stellar_trust_governance::{
    GovernanceContract, GovernanceContractClient, ProposalPayload, ProposalType,
};

const THRESHOLD: i128 = 100;
const VOTING_DELAY: u64 = 60;
const VOTING_PERIOD: u64 = 3_600;
const TIMELOCK_DELAY: u64 = 7_200;

fn setup() -> (Env, Address, Address, GovernanceContractClient<'static>, u64) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let proposer = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let contract_id = env.register_contract(None, GovernanceContract);
    let client = GovernanceContractClient::new(&env, &contract_id);
    client.initialize(&admin, &token_id, &THRESHOLD, &VOTING_DELAY, &VOTING_PERIOD, &TIMELOCK_DELAY, &400, &5_100);

    token::StellarAssetClient::new(&env, &token_id).mint(&proposer, &(THRESHOLD + 500));
    let proposal_id = client.create_proposal(
        &proposer,
        &String::from_str(&env, "Benchmark"),
        &String::from_str(&env, "Benchmark proposal"),
        &ProposalType::TextProposal,
        &ProposalPayload::Text,
        &10_000,
    );

    (env, token_id, proposer, client, proposal_id)
}

fn benchmark_cast_vote(c: &mut Criterion) {
    c.bench_function("governance_cast_vote", |b| {
        b.iter_batched(
            || {
                let (env, token_id, _proposer, client, proposal_id) = setup();
                let voter = Address::generate(&env);
                token::StellarAssetClient::new(&env, &token_id).mint(&voter, &1_000);
                env.ledger().with_mut(|ledger| ledger.timestamp += VOTING_DELAY + 1);
                (client, voter, proposal_id)
            },
            |(client, voter, proposal_id)| client.cast_vote(&voter, &proposal_id, &true),
            BatchSize::SmallInput,
        );
    });
}

fn benchmark_finalize_proposal(c: &mut Criterion) {
    c.bench_function("governance_finalize_proposal", |b| {
        b.iter_batched(
            || {
                let (env, token_id, _proposer, client, proposal_id) = setup();
                let voter = Address::generate(&env);
                token::StellarAssetClient::new(&env, &token_id).mint(&voter, &1_000);
                env.ledger().with_mut(|ledger| ledger.timestamp += VOTING_DELAY + 1);
                client.cast_vote(&voter, &proposal_id, &true);
                env.ledger().with_mut(|ledger| ledger.timestamp += VOTING_PERIOD + 1);
                (client, proposal_id)
            },
            |(client, proposal_id)| client.finalize_proposal(&proposal_id),
            BatchSize::SmallInput,
        );
    });
}

criterion_group!(benches, benchmark_cast_vote, benchmark_finalize_proposal);
criterion_main!(benches);
