use soroban_sdk::{contracttype, Address, String};

/// Supported bridge protocols.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BridgeProtocol {
    Wormhole,
    Allbridge,
}

/// Canonical metadata for a cross-chain (wrapped) token.
#[contracttype]
#[derive(Clone, Debug)]
pub struct WrappedTokenInfo {
    /// The Stellar SAC address of the wrapped token.
    pub stellar_address: Address,
    /// The originating chain identifier (e.g. "ethereum", "solana").
    pub origin_chain: String,
    /// The original token address on the source chain (hex string).
    pub origin_address: String,
    /// Which bridge protocol wrapped this token.
    pub bridge: BridgeProtocol,
    /// Whether this token is approved for use in escrows.
    pub is_approved: bool,
}

/// Payload of the `wtk_reg` event, emitted on every wrapped-token registry
/// write (`register_wrapped_token`).
///
/// Topics are `("wtk_reg", stellar_address)`. Unlike the older `brg_reg`
/// event (origin chain only, still emitted), this carries the full canonical
/// record plus whether it replaced an earlier entry, so an indexer can rebuild
/// the registry — including approval revocations — from events alone.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WrappedTokenRegisteredEvent {
    /// The Stellar SAC address of the wrapped token.
    pub stellar_address: Address,
    /// The originating chain identifier.
    pub origin_chain: String,
    /// The original token address on the source chain.
    pub origin_address: String,
    /// Which bridge protocol wrapped this token.
    pub bridge: BridgeProtocol,
    /// Whether the token is now approved for use in escrows.
    pub is_approved: bool,
    /// Approval state of the replaced record, or `None` for a first registration.
    pub previous_is_approved: Option<bool>,
    /// Admin that performed the registration.
    pub registered_by: Address,
    /// Ledger timestamp of the registration.
    pub registered_at: u64,
}

/// Tracks the confirmation state of a cross-chain deposit.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BridgeConfirmation {
    /// The bridged token used in the escrow.
    pub token: Address,
    /// Bridge protocol used.
    pub bridge: BridgeProtocol,
    /// Number of confirmations received so far.
    pub confirmations: u32,
    /// Whether the transfer has reached `MIN_BRIDGE_CONFIRMATIONS`.
    pub is_finalized: bool,
    /// Ledger timestamp when this record was last updated.
    pub updated_at: u64,
}

/// Persistent storage key for wrapped token metadata.
/// Keyed by the Stellar SAC address of the wrapped token.
#[contracttype]
#[derive(Clone)]
pub enum BridgeDataKey {
    /// WrappedTokenInfo keyed by Stellar token address.
    WrappedToken(Address),
    /// BridgeConfirmation keyed by bridged token address.
    BridgeConfirmation(Address),
}
