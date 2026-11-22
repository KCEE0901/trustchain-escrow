use soroban_sdk::{Address, Env, Vec};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AdminThresholdError {
    InvalidThreshold,
    MissingSigner,
    ThresholdNotMet,
}

/// Requires that at least `threshold` unique `signers` are members of `admins`,
/// and that each signer has authorized the call.
pub fn require_admin_threshold(
    env: &Env,
    admins: &Vec<Address>,
    threshold: u32,
    signers: &Vec<Address>,
) -> Result<(), AdminThresholdError> {
    if threshold == 0 {
        return Err(AdminThresholdError::InvalidThreshold);
    }

    // Count unique, authorized admin signers.
    let mut counted: Vec<Address> = Vec::new(env);
    let mut ok: u32 = 0;

    for i in 0..signers.len() {
        let s = signers.get(i).ok_or(AdminThresholdError::MissingSigner)?;
        if counted.contains(&s) {
            continue;
        }
        if !admins.contains(&s) {
            continue;
        }
        s.require_auth();
        counted.push_back(s);
        ok = ok.saturating_add(1);
        if ok >= threshold {
            return Ok(());
        }
    }

    Err(AdminThresholdError::ThresholdNotMet)
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{contract, testutils::Address as _, vec, Address, Env};

    #[contract]
    struct AuthTestContract;

    fn run<R>(f: impl FnOnce(&Env, &Address, &Address) -> R) -> R {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, AuthTestContract);
        let admin = Address::generate(&env);
        let stranger = Address::generate(&env);
        env.as_contract(&id, || f(&env, &admin, &stranger))
    }

    #[test]
    fn test_require_admin_threshold_authorized_admin_succeeds() {
        run(|env, admin, _| {
            let admins = vec![env, admin.clone()];
            let signers = vec![env, admin.clone()];
            assert_eq!(require_admin_threshold(env, &admins, 1, &signers), Ok(()));
        });
    }

    #[test]
    fn test_require_admin_threshold_rejects_non_admin_signer() {
        run(|env, admin, stranger| {
            let admins = vec![env, admin.clone()];
            let signers = vec![env, stranger.clone()];
            assert_eq!(
                require_admin_threshold(env, &admins, 1, &signers),
                Err(AdminThresholdError::ThresholdNotMet)
            );
        });
    }

    #[test]
    fn test_require_admin_threshold_zero_threshold_returns_error() {
        run(|env, admin, _| {
            let admins = vec![env, admin.clone()];
            let signers = vec![env, admin.clone()];
            assert_eq!(
                require_admin_threshold(env, &admins, 0, &signers),
                Err(AdminThresholdError::InvalidThreshold)
            );
        });
    }

    #[test]
    fn test_require_admin_threshold_max_threshold_returns_error() {
        run(|env, admin, _| {
            let admins = vec![env, admin.clone()];
            let signers = vec![env, admin.clone()];
            assert_eq!(
                require_admin_threshold(env, &admins, u32::MAX, &signers),
                Err(AdminThresholdError::ThresholdNotMet)
            );
        });
    }

    #[test]
    fn test_require_admin_threshold_duplicate_signer_counted_once() {
        run(|env, admin, _| {
            let second = Address::generate(env);
            let admins = vec![env, admin.clone(), second.clone()];
            let dup = vec![env, admin.clone(), admin.clone()];
            assert_eq!(
                require_admin_threshold(env, &admins, 2, &dup),
                Err(AdminThresholdError::ThresholdNotMet)
            );
        });
    }

    #[test]
    fn test_require_admin_threshold_two_distinct_admins_meet_threshold() {
        run(|env, admin, _| {
            let second = Address::generate(env);
            let admins = vec![env, admin.clone(), second.clone()];
            let both = vec![env, admin.clone(), second];
            assert_eq!(require_admin_threshold(env, &admins, 2, &both), Ok(()));
        });
    }
}
