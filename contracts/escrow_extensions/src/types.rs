use soroban_sdk::{contracttype, Address, BytesN, Vec};

// ── Batch creation ────────────────────────────────────────────────────────────

/// Parameters for a single escrow in a batch creation call.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BatchEscrowParams {
    pub freelancer: Address,
    pub token: Address,
    pub total_amount: i128,
    pub brief_hash: BytesN<32>,
    pub arbiter: Option<Address>,
    pub deadline: Option<u64>,
}

// ── Protocol fees ─────────────────────────────────────────────────────────────

/// A single fee recipient with their share in basis points.
#[contracttype]
#[derive(Clone, Debug)]
pub struct FeeRecipient {
    pub address: Address,
    /// Share of the fee in basis points (must sum to 10_000 across all recipients).
    pub share_bps: u32,
}

/// Accumulated fee balance per token.
#[contracttype]
#[derive(Clone, Debug)]
pub struct FeeBalance {
    pub token: Address,
    pub amount: i128,
}

// ── Dispute arbitration ───────────────────────────────────────────────────────

/// A single vote cast by a reputation holder.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Vote {
    pub voter: Address,
    /// Reputation stake committed to this vote.
    pub stake: u64,
    /// true = favour client, false = favour freelancer.
    pub for_client: bool,
    pub cast_at: u64,
}

/// On-chain arbitration state for a disputed escrow.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ArbitrationDispute {
    pub escrow_id: u64,
    /// Ledger timestamp when voting opens.
    pub voting_opens_at: u64,
    /// Ledger timestamp when voting closes (7-day window).
    pub voting_closes_at: u64,
    /// Quadratic-weighted votes for client.
    pub weight_for_client: u64,
    /// Quadratic-weighted votes for freelancer.
    pub weight_for_freelancer: u64,
    /// Total raw stake committed (for slashing calculation).
    pub total_stake: u64,
    /// All individual votes.
    pub votes: Vec<Vote>,
    /// Whether the dispute has been resolved.
    pub resolved: bool,
    /// Resolution: true = client wins, false = freelancer wins.
    pub client_wins: Option<bool>,
}

// ── Proxy / upgrade ───────────────────────────────────────────────────────────

/// A pending upgrade queued with a 24-hour delay.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PendingUpgrade {
    pub new_wasm_hash: BytesN<32>,
    /// Ledger timestamp when the upgrade was queued.
    pub queued_at: u64,
    /// Earliest ledger timestamp when the upgrade can be executed.
    pub executable_after: u64,
    pub queued_by: Address,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    /// Protocol fee in basis points (0–200).
    FeeBps,
    /// Fee recipients list.
    FeeRecipients,
    /// Accumulated fee balance per token: token Address → i128.
    FeeBalance(Address),
    /// Arbitration dispute by escrow ID.
    Dispute(u64),
    /// Pending upgrade.
    PendingUpgrade,
    /// Storage version for migration.
    StorageVersion,
}

#[cfg(test)]
mod batchescrowparams_roundtrip_tests {
    use super::*;
    use soroban_sdk::{Env, IntoVal, TryFromVal, Val};
    #[test]
    fn batchescrowparams_scval_roundtrip() {
        use soroban_sdk::BytesN;
        let env = Env::default();
        let freelancer = soroban_sdk::Address::generate(&env);
        let token = soroban_sdk::Address::generate(&env);
        let hash0 = BytesN::from_array(&env, &[0u8; 32]);
        let zero = BatchEscrowParams { freelancer: freelancer.clone(), token: token.clone(), total_amount: 0, brief_hash: hash0, arbiter: None, deadline: None };
        let back = BatchEscrowParams::try_from_val(&env, &zero.clone().into_val(&env)).unwrap();
        assert_eq!(back.total_amount, 0);
        let hash1 = BytesN::from_array(&env, &[9u8; 32]);
        let arb = soroban_sdk::Address::generate(&env);
        let nz = BatchEscrowParams { freelancer, token, total_amount: 100, brief_hash: hash1, arbiter: Some(arb), deadline: Some(99) };
        let back2 = BatchEscrowParams::try_from_val(&env, &nz.clone().into_val(&env)).unwrap();
        assert_eq!(back2.total_amount, 100);

    }
}
