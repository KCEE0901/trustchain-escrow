use soroban_sdk::contracterror;

/// Stable, deterministic error codes for the escrow contract.
///
/// Codes are grouped by lifecycle stage so that off-chain consumers can
/// branch on a stable contract error instead of parsing ambiguous strings.
/// Existing codes must never be renumbered; append new variants instead.
#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    /// Generic, unspecified failure.
    Unknown = 0,

    // --- Arbiter selection lifecycle (601) ---
    /// The supplied arbiter address is not a valid/eligible arbiter.
    InvalidArbiter = 100,
    /// An arbiter has already been selected for this escrow.
    ArbiterAlreadySet = 101,
    /// The caller is not authorized to select or change the arbiter.
    UnauthorizedArbiterSelection = 102,
    /// No arbiter selection is currently pending for this escrow.
    ArbiterSelectionNotPending = 103,
    /// The arbiter selection has already been finalized and cannot change.
    ArbiterSelectionFinalized = 104,

    // --- Deadline auto-cancellation lifecycle (602) ---
    /// The escrow has no deadline configured, so auto-cancellation cannot run.
    DeadlineNotSet = 200,
    /// The deadline has not yet elapsed; auto-cancellation is not permitted.
    DeadlineNotReached = 201,
    /// The escrow is already in a terminal state and cannot be auto-cancelled.
    EscrowAlreadyFinalized = 202,
    /// The escrow has already been auto-cancelled by a prior call.
    AlreadyAutoCancelled = 203,
}
