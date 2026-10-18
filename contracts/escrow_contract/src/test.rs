use crate::types::{
    get_milestone, require_arbiter_selector, validate_arbiter, validate_arbiter_selection,
    validate_milestone_index, ArbiterSelectionStatus, EscrowError, Milestone, MilestoneStatus,
    MAX_MILESTONES,
};
use soroban_sdk::{vec, Address, Env, String, Vec};

fn sample_milestone(id: u32) -> Milestone {
    Milestone {
        id,
        amount: 100,
        status: MilestoneStatus::Pending,
        description: String::from_str(&Env::default(), "milestone"),
    }
}

#[test]
fn milestone_lookup_success_path() {
    let milestones: Vec<Milestone> = vec![&Env::default(), sample_milestone(0), sample_milestone(1)];

    assert_eq!(validate_milestone_index(0, milestones.len()), Ok(()));
    assert_eq!(validate_milestone_index(1, milestones.len()), Ok(()));

    let found = get_milestone(&milestones, 1).expect("milestone should be found");
    assert_eq!(found.id, 1);
}

#[test]
fn milestone_lookup_missing_index_maps_to_stable_error() {
    let milestones: Vec<Milestone> = vec![&Env::default(), sample_milestone(0)];

    assert_eq!(
        validate_milestone_index(5, milestones.len()),
        Err(EscrowError::MilestoneNotFound)
    );
    assert_eq!(get_milestone(&milestones, 5), Err(EscrowError::MilestoneNotFound));
}

#[test]
fn milestone_lookup_empty_list_maps_to_stable_error() {
    let milestones: Vec<Milestone> = Vec::new(&Env::default());

    assert_eq!(
        validate_milestone_index(0, milestones.len()),
        Err(EscrowError::NoMilestones)
    );
    assert_eq!(get_milestone(&milestones, 0), Err(EscrowError::NoMilestones));
}

#[test]
fn milestone_lookup_beyond_scalability_bound_maps_to_stable_error() {
    assert_eq!(
        validate_milestone_index(MAX_MILESTONES, MAX_MILESTONES),
        Err(EscrowError::MilestoneLookupOutOfBounds)
    );
    assert_eq!(
        validate_milestone_index(MAX_MILESTONES + 1, MAX_MILESTONES + 1),
        Err(EscrowError::MilestoneLookupOutOfBounds)
    );
}

#[test]
fn arbiter_selection_success_path() {
    let env = Env::default();
    let arbiter = Address::generate(&env);

    assert_eq!(
        validate_arbiter_selection(ArbiterSelectionStatus::Pending, &arbiter),
        Ok(())
    );
    assert_eq!(validate_arbiter(&arbiter), Ok(()));
}

#[test]
fn arbiter_selection_already_set_maps_to_stable_error() {
    let env = Env::default();
    let arbiter = Address::generate(&env);

    assert_eq!(
        validate_arbiter_selection(ArbiterSelectionStatus::Selected, &arbiter),
        Err(EscrowError::ArbiterAlreadySet)
    );
}

#[test]
fn arbiter_selection_not_pending_maps_to_stable_error() {
    let env = Env::default();
    let arbiter = Address::generate(&env);

    assert_eq!(
        validate_arbiter_selection(ArbiterSelectionStatus::NotPending, &arbiter),
        Err(EscrowError::ArbiterSelectionNotPending)
    );
}

#[test]
fn arbiter_selection_unauthorized_caller_maps_to_stable_error() {
    let env = Env::default();
    let authorized = Address::generate(&env);
    let caller = Address::generate(&env);

    assert_eq!(
        require_arbiter_selector(&caller, &authorized),
        Err(EscrowError::UnauthorizedArbiterSelection)
    );
    assert_eq!(require_arbiter_selector(&authorized, &authorized), Ok(()));
}
