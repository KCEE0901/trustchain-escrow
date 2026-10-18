use crate::types::{
    get_milestone, validate_milestone_index, EscrowError, Milestone, MilestoneStatus, MAX_MILESTONES,
};
use soroban_sdk::{vec, String, Vec};

fn sample_milestone(id: u32) -> Milestone {
    Milestone {
        id,
        amount: 100,
        status: MilestoneStatus::Pending,
        description: String::from_str(&soroban_sdk::Env::default(), "milestone"),
    }
}

#[test]
fn milestone_lookup_success_path() {
    let milestones: Vec<Milestone> = vec![&soroban_sdk::Env::default(), sample_milestone(0), sample_milestone(1)];

    assert_eq!(validate_milestone_index(0, milestones.len()), Ok(()));
    assert_eq!(validate_milestone_index(1, milestones.len()), Ok(()));

    let found = get_milestone(&milestones, 1).expect("milestone should be found");
    assert_eq!(found.id, 1);
}

#[test]
fn milestone_lookup_missing_index_maps_to_stable_error() {
    let milestones: Vec<Milestone> = vec![&soroban_sdk::Env::default(), sample_milestone(0)];

    assert_eq!(
        validate_milestone_index(5, milestones.len()),
        Err(EscrowError::MilestoneNotFound)
    );
    assert_eq!(get_milestone(&milestones, 5), Err(EscrowError::MilestoneNotFound));
}

#[test]
fn milestone_lookup_empty_list_maps_to_stable_error() {
    let milestones: Vec<Milestone> = Vec::new(&soroban_sdk::Env::default());

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
