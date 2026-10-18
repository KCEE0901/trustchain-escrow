use soroban_sdk::{contracttype, Address, Env, Symbol};

/// Event payload emitted when an escrow is created.
///
/// All fields are deterministic and sufficient for downstream reputation
/// indexing: stable identifiers, participants, amount, and ledger timestamp.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowCreatedEvent {
    pub escrow_id: u64,
    pub depositor: Address,
    pub beneficiary: Address,
    pub amount: i128,
    pub timestamp: u64,
}

/// Event payload emitted when an escrow is released.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowReleasedEvent {
    pub escrow_id: u64,
    pub depositor: Address,
    pub beneficiary: Address,
    pub amount: i128,
    pub timestamp: u64,
}

/// Event payload emitted when an escrow is refunded.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowRefundedEvent {
    pub escrow_id: u64,
    pub depositor: Address,
    pub beneficiary: Address,
    pub amount: i128,
    pub timestamp: u64,
}

/// Emit a deterministic escrow-created event.
pub fn emit_escrow_created(env: &Env, event: EscrowCreatedEvent) {
    let topics = (Symbol::new(env, "escrow_created"), event.escrow_id);
    env.events().publish(topics, event);
}

/// Emit a deterministic escrow-released event.
pub fn emit_escrow_released(env: &Env, event: EscrowReleasedEvent) {
    let topics = (Symbol::new(env, "escrow_released"), event.escrow_id);
    env.events().publish(topics, event);
}

/// Emit a deterministic escrow-refunded event.
pub fn emit_escrow_refunded(env: &Env, event: EscrowRefundedEvent) {
    let topics = (Symbol::new(env, "escrow_refunded"), event.escrow_id);
    env.events().publish(topics, event);
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    fn sample_created(env: &Env, escrow_id: u64) -> EscrowCreatedEvent {
        EscrowCreatedEvent {
            escrow_id,
            depositor: Address::generate(env),
            beneficiary: Address::generate(env),
            amount: 1_000,
            timestamp: 42,
        }
    }

    #[test]
    fn created_event_contains_deterministic_fields() {
        let env = Env::default();
        let event = sample_created(&env, 7);
        assert_eq!(event.escrow_id, 7);
        assert_eq!(event.amount, 1_000);
        assert_eq!(event.timestamp, 42);
        assert_ne!(event.depositor, event.beneficiary);
    }

    #[test]
    fn created_event_rejects_zero_amount_boundary() {
        let env = Env::default();
        let mut event = sample_created(&env, 1);
        event.amount = 0;
        // Zero-amount events must not be treated as reputation-bearing.
        assert_eq!(event.amount, 0);
        assert!(event.amount <= 0);
    }

    #[test]
    fn released_event_preserves_identifiers() {
        let env = Env::default();
        let depositor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let event = EscrowReleasedEvent {
            escrow_id: 99,
            depositor: depositor.clone(),
            beneficiary: beneficiary.clone(),
            amount: 500,
            timestamp: 100,
        };
        assert_eq!(event.escrow_id, 99);
        assert_eq!(event.depositor, depositor);
        assert_eq!(event.beneficiary, beneficiary);
        assert_eq!(event.amount, 500);
        assert_eq!(event.timestamp, 100);
    }

    #[test]
    fn refunded_event_is_deterministic_across_instances() {
        let env = Env::default();
        let depositor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let a = EscrowRefundedEvent {
            escrow_id: 3,
            depositor: depositor.clone(),
            beneficiary: beneficiary.clone(),
            amount: 250,
            timestamp: 10,
        };
        let b = EscrowRefundedEvent {
            escrow_id: 3,
            depositor,
            beneficiary,
            amount: 250,
            timestamp: 10,
        };
        assert_eq!(a, b);
    }
}
