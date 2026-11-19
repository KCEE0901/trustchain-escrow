//! # Staking Lock Duration Extension Incentive
//!
//! Bonus multiplier for stakers who extend their lock duration by more than 1 year.
//!
//! Formula: `multiplier = SCALE + (extension_duration * SCALE / MAX_LOCK_DURATION)`
//!
//! Bonus tokens are sourced exclusively from the platform incentives pool.

use soroban_sdk::{contracttype, symbol_short, Address, Env};

// ── Constants ─────────────────────────────────────────────────────────────────

pub const ONE_YEAR_SECS: u64 = 31_536_000;
pub const MAX_LOCK_DURATION: u64 = 4 * ONE_YEAR_SECS; // 4-year ceiling
/// Fixed-point scale factor: SCALE == 1.0x multiplier.
pub const SCALE: u64 = 1_000_000;

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub enum IncentivesKey {
    LockRecord(Address),
    IncentivesPool,
}

// ── Types ─────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct LockRecord {
    pub staker: Address,
    pub locked_amount: i128,
    pub bonus_accumulated: i128,
    pub lock_end: u64,
    pub last_extension_at: u64,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ExtensionError {
    /// new_lock_end <= current_lock_end
    InvalidExtension,
    /// Pool balance is below the computed bonus
    InsufficientIncentivesPool,
    /// Amount must be > 0
    InvalidAmount,
    /// Caller is not authorized to perform this action
    Unauthorized,
    /// Numeric argument is out of the accepted range
    OutOfRange,
}

// ── Pure computation ──────────────────────────────────────────────────────────

/// Compute the bonus multiplier in SCALE-fixed-point.
///
/// Returns `SCALE` (= 1.0x) when `max_duration == 0` (division-by-zero guard)
/// or when `extension_duration == 0`.
pub fn compute_multiplier(extension_duration: u64, max_duration: u64) -> u64 {
    if max_duration == 0 || extension_duration == 0 {
        return SCALE;
    }
    // SCALE + (ext * SCALE / max)
    SCALE.saturating_add(
        extension_duration
            .saturating_mul(SCALE)
            .saturating_div(max_duration),
    )
}

/// Compute bonus tokens from locked amount and multiplier.
///
/// `bonus = locked_amount * (multiplier - SCALE) / SCALE`
pub fn compute_bonus_tokens(locked_amount: i128, multiplier: u64) -> i128 {
    if multiplier <= SCALE {
        return 0;
    }
    locked_amount.saturating_mul((multiplier - SCALE) as i128) / SCALE as i128
}

// ── Storage operations ────────────────────────────────────────────────────────

/// Deposit tokens into the platform incentives pool (admin action — caller
/// must have already transferred tokens to the contract before calling this).
///
/// The `admin` must authorize the call. `amount` must be strictly positive and
/// must not overflow the current pool balance.
pub fn deposit_to_pool(
    env: &Env,
    admin: &Address,
    amount: i128,
) -> Result<(), ExtensionError> {
    admin.require_auth();

    if amount <= 0 {
        return Err(ExtensionError::InvalidAmount);
    }
    let current: i128 = env
        .storage()
        .instance()
        .get(&IncentivesKey::IncentivesPool)
        .unwrap_or(0);
    let new_balance = match current.checked_add(amount) {
        Some(v) => v,
        None => return Err(ExtensionError::InvalidAmount),
    };
    env.storage()
        .instance()
        .set(&IncentivesKey::IncentivesPool, &new_balance);
    Ok(())
}

/// Returns the current incentives pool balance.
pub fn get_pool_balance(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&IncentivesKey::IncentivesPool)
        .unwrap_or(0)
}

/// Returns the lock record for a staker, if any.
pub fn get_lock_record(env: &Env, staker: &Address) -> Option<LockRecord> {
    env.storage()
        .persistent()
        .get(&IncentivesKey::LockRecord(staker.clone()))
}

/// Apply the lock extension bonus for a staker.
///
/// Only triggers when `extension_duration >= ONE_YEAR_SECS`.
/// Bonus tokens are deducted from the platform incentives pool.
///
/// # Returns
/// `Ok(bonus_tokens)` — `0` if the extension is below the 1-year threshold.
pub fn apply_lock_extension_bonus(
    env: &Env,
    staker: &Address,
    current_lock_end: u64,
    new_lock_end: u64,
    locked_amount: i128,
) -> Result<i128, ExtensionError> {
    staker.require_auth();

    if locked_amount <= 0 {
        return Err(ExtensionError::InvalidAmount);
    }

    if new_lock_end <= current_lock_end {
        return Err(ExtensionError::InvalidExtension);
    }

    let extension_duration = match new_lock_end.checked_sub(current_lock_end) {
        Some(v) => v,
        None => return Err(ExtensionError::OutOfRange),
    };
    if extension_duration < ONE_YEAR_SECS {
        return Ok(0);
    }

    let multiplier = compute_multiplier(extension_duration, MAX_LOCK_DURATION);
    let bonus_tokens = compute_bonus_tokens(locked_amount, multiplier);

    if bonus_tokens <= 0 {
        return Ok(0);
    }

    let pool_balance = get_pool_balance(env);
    if pool_balance < bonus_tokens {
        return Err(ExtensionError::InsufficientIncentivesPool);
    }

    // Deduct from pool
    env.storage().instance().set(
        &IncentivesKey::IncentivesPool,
        &(pool_balance - bonus_tokens),
    );

    // Update staker record
    let now = env.ledger().timestamp();
    let mut record: LockRecord = env
        .storage()
        .persistent()
        .get(&IncentivesKey::LockRecord(staker.clone()))
        .unwrap_or(LockRecord {
            staker: staker.clone(),
            locked_amount,
            bonus_accumulated: 0,
            lock_end: new_lock_end,
            last_extension_at: now,
        });

    record.bonus_accumulated += bonus_tokens;
    record.lock_end = new_lock_end;
    record.last_extension_at = now;
    env.storage()
        .persistent()
        .set(&IncentivesKey::LockRecord(staker.clone()), &record);

    env.events().publish(
        (symbol_short!("lk_bonus"), staker.clone()),
        (bonus_tokens, multiplier, extension_duration),
    );

    Ok(bonus_tokens)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod incentive_tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{contract, contractimpl, Address, Env};

    // Minimal stub contract so tests can access env.storage()
    #[contract]
    struct TestContract;
    #[contractimpl]
    impl TestContract {}

    fn mk_env() -> (Env, Address) {
        let env = Env::default();
        let id = env.register_contract(None, TestContract);
        (env, id)
    }

    // ── Pure computation tests (no contract context needed) ───────────────────

    #[test]
    fn test_compute_multiplier_zero_max_guard() {
        assert_eq!(compute_multiplier(ONE_YEAR_SECS, 0), SCALE);
    }

    #[test]
    fn test_compute_multiplier_zero_extension() {
        assert_eq!(compute_multiplier(0, MAX_LOCK_DURATION), SCALE);
    }

    #[test]
    fn test_compute_multiplier_full_max() {
        // extension == max → 1.0 + 1.0 = 2.0
        assert_eq!(
            compute_multiplier(MAX_LOCK_DURATION, MAX_LOCK_DURATION),
            2 * SCALE
        );
    }

    #[test]
    fn test_compute_multiplier_half_max() {
        // extension = max/2 → 1.0 + 0.5 = 1.5
        let m = compute_multiplier(MAX_LOCK_DURATION / 2, MAX_LOCK_DURATION);
        assert_eq!(m, SCALE + SCALE / 2);
    }

    #[test]
    fn test_compute_multiplier_one_year_of_four() {
        // extension = 1yr / 4yr → 1.0 + 0.25 = 1.25
        let m = compute_multiplier(ONE_YEAR_SECS, MAX_LOCK_DURATION);
        assert_eq!(m, SCALE + SCALE / 4);
    }

    #[test]
    fn test_compute_bonus_tokens_zero_when_at_scale() {
        assert_eq!(compute_bonus_tokens(100_000, SCALE), 0);
    }

    #[test]
    fn test_compute_bonus_tokens_one_year_extension() {
        // multiplier = 1.25 SCALE → bonus = 25% of locked
        let m = compute_multiplier(ONE_YEAR_SECS, MAX_LOCK_DURATION);
        let bonus = compute_bonus_tokens(100_000, m);
        assert_eq!(bonus, 25_000);
    }

    #[test]
    fn test_compute_bonus_tokens_two_year_extension() {
        // multiplier = 1.5 SCALE → bonus = 50% of locked
        let m = compute_multiplier(2 * ONE_YEAR_SECS, MAX_LOCK_DURATION);
        let bonus = compute_bonus_tokens(100_000, m);
        assert_eq!(bonus, 50_000);
    }

    // ── Storage / integration tests ───────────────────────────────────────────

    #[test]
    fn test_apply_bonus_below_one_year_returns_zero() {
        let (env, id) = mk_env();
        env.mock_all_auths();
        env.as_contract(&id, || {
            let staker = Address::generate(&env);
            let bonus =
                apply_lock_extension_bonus(&env, &staker, 0, ONE_YEAR_SECS - 1, 10_000).unwrap();
            assert_eq!(bonus, 0);
        });
    }

    #[test]
    fn test_apply_bonus_exactly_one_year() {
        let (env, id) = mk_env();
        env.mock_all_auths();
        env.as_contract(&id, || {
            let admin = Address::generate(&env);
            let staker = Address::generate(&env);
            deposit_to_pool(&env, &admin, 50_000).unwrap();

            let bonus =
                apply_lock_extension_bonus(&env, &staker, 0, ONE_YEAR_SECS, 100_000).unwrap();
            // multiplier = 1.25, bonus = 25_000
            assert_eq!(bonus, 25_000);
            assert_eq!(get_pool_balance(&env), 25_000);

            let rec = get_lock_record(&env, &staker).unwrap();
            assert_eq!(rec.bonus_accumulated, 25_000);
            assert_eq!(rec.lock_end, ONE_YEAR_SECS);
        });
    }

    #[test]
    fn test_apply_bonus_insufficient_pool_fails() {
        let (env, id) = mk_env();
        env.mock_all_auths();
        env.as_contract(&id, || {
            let staker = Address::generate(&env);
            let result = apply_lock_extension_bonus(&env, &staker, 0, ONE_YEAR_SECS, 100_000);
            assert_eq!(result, Err(ExtensionError::InsufficientIncentivesPool));
        });
    }

    #[test]
    fn test_apply_bonus_invalid_extension_fails() {
        let (env, id) = mk_env();
        env.mock_all_auths();
        env.as_contract(&id, || {
            let staker = Address::generate(&env);
            let result = apply_lock_extension_bonus(&env, &staker, 1_000, 500, 10_000);
            assert_eq!(result, Err(ExtensionError::InvalidExtension));
        });
    }

    #[test]
    fn test_multiple_milestone_extensions() {
        let (env, id) = mk_env();
        env.mock_all_auths();
        env.as_contract(&id, || {
            let admin = Address::generate(&env);
            let staker = Address::generate(&env);
            deposit_to_pool(&env, &admin, 200_000).unwrap();

            let b1 = apply_lock_extension_bonus(&env, &staker, 0, ONE_YEAR_SECS, 100_000).unwrap();
            let b2 = apply_lock_extension_bonus(
                &env,
                &staker,
                ONE_YEAR_SECS,
                2 * ONE_YEAR_SECS,
                100_000,
            )
            .unwrap();
            let b3 = apply_lock_extension_bonus(
                &env,
                &staker,
                2 * ONE_YEAR_SECS,
                3 * ONE_YEAR_SECS,
                100_000,
            )
            .unwrap();

            assert!(b1 > 0 && b2 > 0 && b3 > 0);

            let rec = get_lock_record(&env, &staker).unwrap();
            assert_eq!(rec.bonus_accumulated, b1 + b2 + b3);
            assert_eq!(rec.lock_end, 3 * ONE_YEAR_SECS);
        });
    }

    #[test]
    fn test_reward_yield_scales_with_locked_amount() {
        let (env, id) = mk_env();
        env.mock_all_auths();
        env.as_contract(&id, || {
            let admin = Address::generate(&env);
            let s1 = Address::generate(&env);
            let s2 = Address::generate(&env);
            deposit_to_pool(&env, &admin, 1_000_000).unwrap();

            let b1 = apply_lock_extension_bonus(&env, &s1, 0, ONE_YEAR_SECS, 100_000).unwrap();
            let b2 = apply_lock_extension_bonus(&env, &s2, 0, ONE_YEAR_SECS, 200_000).unwrap();

            // Staker with 2× locked gets 2× bonus
            assert_eq!(b2, 2 * b1);
        });
    }

    #[test]
    fn test_deposit_to_pool_increases_balance() {
        let (env, id) = mk_env();
        env.mock_all_auths();
        env.as_contract(&id, || {
            let admin = Address::generate(&env);
            assert_eq!(get_pool_balance(&env), 0);
            deposit_to_pool(&env, &admin, 5_000).unwrap();
            assert_eq!(get_pool_balance(&env), 5_000);
            deposit_to_pool(&env, &admin, 3_000).unwrap();
            assert_eq!(get_pool_balance(&env), 8_000);
        });
    }

    #[test]
    fn test_deposit_to_pool_zero_fails() {
        let (env, id) = mk_env();
        env.mock_all_auths();
        env.as_contract(&id, || {
            let admin = Address::generate(&env);
            assert_eq!(
                deposit_to_pool(&env, &admin, 0),
                Err(ExtensionError::InvalidAmount)
            );
        });
    }

    // ── Caller / bound checks (issues #720, #723) ─────────────────────────────

    #[test]
    fn test_deposit_to_pool_requires_admin_auth() {
        let (env, id) = mk_env();
        env.as_contract(&id, || {
            let admin = Address::generate(&env);
            let other = Address::generate(&env);

            // Authorized caller succeeds.
            env.mock_auths(&[soroban_sdk::testutils::MockAuth {
                address: &admin,
                invoke: &soroban_sdk::testutils::MockAuthInvoke {
                    contract: &id,
                    fn_name: "deposit_to_pool",
                    args: (admin.clone(), 1_000_i128).into_val(&env),
                    sub_invokes: &[],
                },
            }]);
            assert_eq!(deposit_to_pool(&env, &admin, 1_000), Ok(()));
            assert_eq!(get_pool_balance(&env), 1_000);

            // A different address must not be able to authorize on behalf of admin.
            env.mock_auths(&[soroban_sdk::testutils::MockAuth {
                address: &other,
                invoke: &soroban_sdk::testutils::MockAuthInvoke {
                    contract: &id,
                    fn_name: "deposit_to_pool",
                    args: (admin.clone(), 1_000_i128).into_val(&env),
                    sub_invokes: &[],
                },
            }]);
            let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                deposit_to_pool(&env, &admin, 1_000)
            }));
            assert!(res.is_err() || res.unwrap().is_err());
        });
    }

    #[test]
    fn test_deposit_to_pool_bounds() {
        let (env, id) = mk_env();
        env.mock_all_auths();
        env.as_contract(&id, || {
            let admin = Address::generate(&env);

            // Zero and negative are rejected with the crate error, not a panic.
            assert_eq!(
                deposit_to_pool(&env, &admin, 0),
                Err(ExtensionError::InvalidAmount)
            );
            assert_eq!(
                deposit_to_pool(&env, &admin, -1),
                Err(ExtensionError::InvalidAmount)
            );

            // i128::MAX is accepted when the pool is empty.
            assert_eq!(deposit_to_pool(&env, &admin, i128::MAX), Ok(()));
            assert_eq!(get_pool_balance(&env), i128::MAX);

            // Any further deposit would overflow and must be rejected.
            assert_eq!(
                deposit_to_pool(&env, &admin, 1),
                Err(ExtensionError::InvalidAmount)
            );
            assert_eq!(
                deposit_to_pool(&env, &admin, i128::MAX),
                Err(ExtensionError::InvalidAmount)
            );
        });
    }

    #[test]
    fn test_apply_lock_extension_bonus_requires_staker_auth() {
        let (env, id) = mk_env();
        env.mock_all_auths();
        env.as_contract(&id, || {
            let admin = Address::generate(&env);
            deposit_to_pool(&env, &admin, 50_000).unwrap();

            let staker = Address::generate(&env);
            let other = Address::generate(&env);

            // Authorized staker succeeds.
            env.mock_auths(&[soroban_sdk::testutils::MockAuth {
                address: &staker,
                invoke: &soroban_sdk::testutils::MockAuthInvoke {
                    contract: &id,
                    fn_name: "apply_lock_extension_bonus",
                    args: (staker.clone(), 0_u64, ONE_YEAR_SECS, 100_000_i128).into_val(&env),
                    sub_invokes: &[],
                },
            }]);
            let bonus =
                apply_lock_extension_bonus(&env, &staker, 0, ONE_YEAR_SECS, 100_000).unwrap();
            assert_eq!(bonus, 25_000);

            // A different address must not authorize on behalf of the staker.
            let staker2 = Address::generate(&env);
            env.mock_auths(&[soroban_sdk::testutils::MockAuth {
                address: &other,
                invoke: &soroban_sdk::testutils::MockAuthInvoke {
                    contract: &id,
                    fn_name: "apply_lock_extension_bonus",
                    args: (staker2.clone(), 0_u64, ONE_YEAR_SECS, 100_000_i128).into_val(&env),
                    sub_invokes: &[],
                },
            }]);
            let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                apply_lock_extension_bonus(&env, &staker2, 0, ONE_YEAR_SECS, 100_000)
            }));
            assert!(res.is_err() || res.unwrap().is_err());
        });
    }

    #[test]
    fn test_apply_lock_extension_bonus_bounds() {
        let (env, id) = mk_env();
        env.mock_all_auths();
        env.as_contract(&id, || {
            let admin = Address::generate(&env);
            deposit_to_pool(&env, &admin, 1_000_000).unwrap();
            let staker = Address::generate(&env);

            // locked_amount == 0 is rejected with the crate error.
            assert_eq!(
                apply_lock_extension_bonus(&env, &staker, 0, ONE_YEAR_SECS, 0),
                Err(ExtensionError::InvalidAmount)
            );
            // Negative locked_amount is rejected.
            assert_eq!(
                apply_lock_extension_bonus(&env, &staker, 0, ONE_YEAR_SECS, -1),
                Err(ExtensionError::InvalidAmount)
            );

            // u64::MAX as new_lock_end must not panic.
            let res = apply_lock_extension_bonus(&env, &staker, 0, u64::MAX, 100_000);
            assert!(res.is_ok() || res.is_err());

            // current_lock_end == u64::MAX with new_lock_end == 0 is an invalid extension.
            assert_eq!(
                apply_lock_extension_bonus(&env, &staker, u64::MAX, 0, 100_000),
                Err(ExtensionError::InvalidExtension)
            );

            // i128::MAX locked_amount must not panic (saturating math).
            let res = apply_lock_extension_bonus(&env, &staker, 0, ONE_YEAR_SECS, i128::MAX);
            assert!(res.is_ok() || res.is_err());
        });
    }
}
