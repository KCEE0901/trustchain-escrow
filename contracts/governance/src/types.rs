use soroban_sdk::{contracttype, Address, String};

// ── Proposal types ────────────────────────────────────────────────────────────

/// The kind of action a proposal will execute if it passes.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalType {
    /// Change a named protocol parameter (e.g. platform fee, quorum %).
    ParameterChange,
    /// Upgrade a target contract to a new WASM hash.
    ContractUpgrade,
    /// Allocate funds from the governance treasury to an address.
    FundAllocation,
    /// Signal-only proposal with no on-chain execution.
    TextProposal,
}

/// Lifecycle state of a proposal.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalStatus {
    /// Voting is open.
    Active,
    /// Voting period ended; quorum + threshold met. Awaiting timelock.
    Passed,
    /// Voting period ended; quorum or threshold not met.
    Defeated,
    /// Passed + timelock elapsed; ready to execute.
    Queued,
    /// Successfully executed.
    Executed,
    /// Cancelled by the proposer or admin before execution.
    Cancelled,
}

/// A single vote cast by an address.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Vote {
    pub voter: Address,
    pub support: bool, // true = for, false = against
    pub power: i128,   // voting power at time of vote
    pub cast_at: u64,  // ledger timestamp
}

/// Execution payload for a ParameterChange proposal.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ParameterPayload {
    pub key: String,
    pub value: i128,
}

/// Execution payload for a ContractUpgrade proposal.
#[contracttype]
#[derive(Clone, Debug)]
pub struct UpgradePayload {
    pub target_contract: Address,
    pub new_wasm_hash: soroban_sdk::BytesN<32>,
}

/// Execution payload for a FundAllocation proposal.
#[contracttype]
#[derive(Clone, Debug)]
pub struct FundPayload {
    pub recipient: Address,
    pub token: Address,
    pub amount: i128,
}

/// Union of all possible execution payloads.
#[contracttype]
#[derive(Clone, Debug)]
pub enum ProposalPayload {
    Parameter(ParameterPayload),
    Upgrade(UpgradePayload),
    Fund(FundPayload),
    Text,
}

/// A governance proposal.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: u64,
    pub proposal_type: ProposalType,
    pub proposer: Address,
    pub title: String,
    pub description: String,
    pub payload: ProposalPayload,
    pub status: ProposalStatus,

    /// Ledger timestamp when voting opens.
    pub vote_start: u64,
    /// Ledger timestamp when voting closes.
    pub vote_end: u64,
    /// Ledger timestamp after which the proposal can be executed (vote_end + timelock).
    pub executable_at: u64,

    /// Total voting power that voted FOR.
    pub votes_for: i128,
    /// Total voting power that voted AGAINST.
    pub votes_against: i128,

    /// Snapshot of total token supply at proposal creation (for quorum calc).
    pub total_supply_snapshot: i128,

    pub created_at: u64,
    pub executed_at: Option<u64>,
}

/// Governance configuration parameters.
#[contracttype]
#[derive(Clone, Debug)]
pub struct GovConfig {
    /// Governance token address (voting power = token balance).
    pub token: Address,

    /// Minimum tokens required to create a proposal.
    pub proposal_threshold: i128,

    /// Voting period duration in seconds.
    pub voting_period: u64,

    /// Delay between proposal creation and vote start (in seconds).
    pub voting_delay: u64,

    /// Timelock delay between a passed vote and execution (in seconds).
    pub timelock_delay: u64,

    /// Minimum % of total supply that must vote for quorum (basis points, e.g. 400 = 4%).
    pub quorum_bps: u32,

    /// Minimum % of votes that must be FOR to pass (basis points, e.g. 5100 = 51%).
    pub approval_threshold_bps: u32,
}

// ── ve-token types ────────────────────────────────────────────────────────────

/// A time-locked token position that grants time-weighted voting power.
///
/// voting_power = locked_amount * (remaining_duration / MAX_LOCK_DURATION)
///
/// Power decays linearly as `unlock_time` approaches.
#[contracttype]
#[derive(Clone, Debug)]
pub struct VeLock {
    /// Amount of governance tokens locked.
    pub amount: i128,
    /// Ledger timestamp when the lock expires and tokens can be withdrawn.
    pub unlock_time: u64,
    /// Ledger timestamp when the lock was created or last extended.
    pub locked_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct JuryPool {
    pub pool_id: u64,
    pub escrow_id: u64,
    pub milestone_id: u64,
    pub created_at: u64,
    pub voting_end: u64,
    pub resolved: bool,
    pub weight_for_client: i128,
    pub weight_for_freelancer: i128,
    pub total_locked: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct JuryVote {
    pub voter: Address,
    pub locked_tokens: i128,
    pub for_client: bool,
}

/// Storage keys.
#[contracttype]
pub enum DataKey {
    Admin,
    Config,
    ProposalCounter,
    Proposal(u64),
    /// Whether `voter` has voted on proposal `id`: (proposal_id, voter)
    HasVoted(u64, Address),
    /// Voting power snapshot for (proposal_id, voter): i128
    VoteRecord(u64, Address),
    // ── Arbitrator DAO ────────────────────────────────────────────────────────
    /// Registered arbitrator whitelist entry — key: Address, value: bool
    Arbitrator(Address),
    /// Arbitrator stake — key: Address, value: i128
    ArbitratorStake(Address),
    /// Cooldown expiry for stake withdrawal — key: Address, value: u64
    WithdrawCooldown(Address),
    /// Slash record counter
    SlashCounter,
    /// Fee deposit locked for a proposal — key: proposal_id, value: i128
    ProposalDeposit(u64),
    /// Treasury address for slashed fee deposits — instance storage
    Treasury,
    // ── ve-token (voting escrow) ──────────────────────────────────────────────
    /// Active lock for an address — key: Address, value: VeLock
    VeLock(Address),
    IncentivesPool,
    JuryPoolCounter,
    JuryPool(u64),
    JuryVote(u64, Address),
    JuryVoterStake(u64, Address),
}

#[cfg(test)]
mod velock_roundtrip_tests {
    use super::*;
    use soroban_sdk::{Env, IntoVal, TryFromVal, Val};

    #[test]
    fn velock_scval_roundtrip_zero_and_nonzero() {
        let env = Env::default();
        let zero = VeLock {
            amount: 0,
            unlock_time: 0,
            locked_at: 0,
        };
        let val: Val = zero.clone().into_val(&env);
        let back = VeLock::try_from_val(&env, &val).expect("VeLock round-trip");
        assert_eq!(back.amount, zero.amount);
        assert_eq!(back.unlock_time, zero.unlock_time);
        assert_eq!(back.locked_at, zero.locked_at);

        let nonzero = VeLock {
            amount: 1_000,
            unlock_time: 9_999,
            locked_at: 1_700_000_000,
        };
        let val2: Val = nonzero.clone().into_val(&env);
        let back2 = VeLock::try_from_val(&env, &val2).expect("VeLock round-trip");
        assert_eq!(back2.amount, nonzero.amount);
        assert_eq!(back2.unlock_time, nonzero.unlock_time);
        assert_eq!(back2.locked_at, nonzero.locked_at);
    }
}

#[cfg(test)]
mod upgradepayload_roundtrip_tests {
    use super::*;
    use soroban_sdk::{Address, BytesN, Env, IntoVal, TryFromVal, Val};

    #[test]
    fn upgradepayload_scval_roundtrip_zero_and_nonzero() {
        let env = Env::default();
        let zero_hash = BytesN::from_array(&env, &[0u8; 32]);
        let full_hash = BytesN::from_array(&env, &[0xAB; 32]);
        let target = Address::generate(&env);

        let zero = UpgradePayload {
            target_contract: target.clone(),
            new_wasm_hash: zero_hash,
        };
        let val: Val = zero.clone().into_val(&env);
        let back = UpgradePayload::try_from_val(&env, &val).expect("UpgradePayload round-trip");
        assert_eq!(back.target_contract, zero.target_contract);
        assert_eq!(back.new_wasm_hash, zero.new_wasm_hash);

        let nonzero = UpgradePayload {
            target_contract: target,
            new_wasm_hash: full_hash,
        };
        let val2: Val = nonzero.clone().into_val(&env);
        let back2 = UpgradePayload::try_from_val(&env, &val2).expect("UpgradePayload round-trip");
        assert_eq!(back2.target_contract, nonzero.target_contract);
        assert_eq!(back2.new_wasm_hash, nonzero.new_wasm_hash);
    }
}
