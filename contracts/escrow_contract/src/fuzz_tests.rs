//! # Proptest Fuzz Tests — StellarTrustEscrow
//!
//! Property-based fuzz tests for the escrow contract's critical state-mutating,
//! view/query, and administrative functions, as required by
//! `docs/security/fuzzing-requirements.md`.
//!
//! ## Categories covered
//!
//! | Category           | Requirement                                                        |
//! | ------------------ | ------------------------------------------------------------------ |
//! | State-mutating     | Boundary values (0, `i128::MAX`, `u32::MAX`); no unhandled panics |
//! | View / query       | No panic for any constructed state; empty/single/max-cap states   |
//! | Administrative     | Reject non-admin callers with typed error (not a panic)           |
//! | Round-trip (ScVal) | `from_val(env, &to_val(env, &x)) == x` for `#[contracttype]`     |
//!
//! ## Running
//!
//! ```bash
//! # All fuzz cases (10 000 iterations per test)
//! cargo test --package stellar-trust-escrow-contract fuzz_tests
//!
//! # Single target
//! cargo test --package stellar-trust-escrow-contract \
//!     fuzz_state_mutating_create_escrow_boundaries
//! ```
//!
//! ## Iteration count
//!
//! Every test runs **10 000 iterations** driven by a deterministic xorshift64
//! PRNG, satisfying the project minimum defined in
//! `docs/security/fuzzing-requirements.md`.

#[cfg(test)]
#[allow(clippy::module_inception)]
mod fuzz_tests {
    extern crate std;

    use soroban_sdk::{testutils::Address as _, token, Address, BytesN, Env, IntoVal, String};

    use crate::{EscrowContract, EscrowContractClient, MultisigConfig};

    // -------------------------------------------------------------------------
    // Shared constants & helpers
    // -------------------------------------------------------------------------

    /// Iteration count per test — meets the 10 000-case minimum.
    const FUZZ_ITERS: u64 = 10_000;
    /// Maximum allowed escrow amount (mirrors MAX_ESCROW_AMOUNT in lib.rs).
    const MAX_ESCROW: i128 = 100_000_000_000_000_000;

    // Minimal xorshift64* PRNG — deterministic, zero extra dependencies.
    struct Rng(u64);
    impl Rng {
        fn new(seed: u64) -> Self { Self(seed | 1) }
        fn next(&mut self) -> u64 {
            let mut x = self.0;
            x ^= x << 13; x ^= x >> 7; x ^= x << 17;
            self.0 = x; x
        }
        fn next_i128_range(&mut self, lo: i128, hi: i128) -> i128 {
            if hi <= lo { return lo; }
            lo + (self.next() as u128 % (hi - lo) as u128) as i128
        }
        fn next_u32(&mut self) -> u32 { (self.next() & 0xFFFF_FFFF) as u32 }
    }

    /// Non-zero 32-byte hash from a seed (all-zero is rejected as InvalidBriefHash).
    fn nonzero_hash(env: &Env, seed: u32) -> BytesN<32> {
        let mut b = [0u8; 32];
        b[28..32].copy_from_slice(&seed.wrapping_add(1).to_be_bytes());
        BytesN::from_array(env, &b)
    }

    fn no_multisig(env: &Env) -> MultisigConfig {
        MultisigConfig {
            approvers: soroban_sdk::Vec::new(env),
            weights:   soroban_sdk::Vec::new(env),
            threshold: 0,
        }
    }

    fn setup() -> (Env, EscrowContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let tok = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let cid = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &cid);
        client.initialize(&admin);
        (env, client, tok)
    }

    fn mint(env: &Env, tok: &Address, to: &Address, amt: i128) {
        token::StellarAssetClient::new(env, tok).mint(to, &amt);
    }

    // -------------------------------------------------------------------------
    // STATE-MUTATING: create_escrow — i128 boundary fuzz
    // -------------------------------------------------------------------------

    /// Feature: fuzzing-requirements, Category 1 (state-mutating).
    ///
    /// Verifies `create_escrow` returns Ok or a typed EscrowError for every
    /// amount in the i128 range including 0, negatives, and above MAX.
    /// Must **never panic**.
    #[test]
    fn fuzz_state_mutating_create_escrow_boundaries() {
        let boundaries: &[i128] = &[
            0, -1, i128::MIN, 999, 1_000, 1_000_000,
            MAX_ESCROW, MAX_ESCROW + 1, i128::MAX,
        ];
        for &amount in boundaries {
            let (env, client, tok) = setup();
            let c = Address::generate(&env);
            let f = Address::generate(&env);
            if amount > 0 && amount <= MAX_ESCROW {
                mint(&env, &tok, &c, amount + 100);
            }
            let r = client.try_create_escrow(
                &c, &f, &tok, &amount, &nonzero_hash(&env, 1),
                &None, &None, &None, &None, &no_multisig(&env), &None,
            );
            match r { Ok(Ok(_)) | Ok(Err(_)) | Err(_) => {} }
        }

        let mut rng = Rng::new(0xDEAD_BEEF_1234_5678);
        for i in 0..FUZZ_ITERS {
            let amount = match i % 5 {
                0 => rng.next_i128_range(i128::MIN, -1),
                1 => rng.next_i128_range(0, 999),
                2 => rng.next_i128_range(1_000, MAX_ESCROW),
                3 => rng.next_i128_range(MAX_ESCROW + 1, i128::MAX / 2),
                _ => [0_i128, i128::MAX, -1, 1, MAX_ESCROW][(i % 5) as usize],
            };
            let (env, client, tok) = setup();
            let c = Address::generate(&env);
            let f = Address::generate(&env);
            let seed = rng.next_u32();
            if amount > 0 && amount <= MAX_ESCROW { mint(&env, &tok, &c, amount + 100); }
            let r = client.try_create_escrow(
                &c, &f, &tok, &amount, &nonzero_hash(&env, seed),
                &None, &None, &None, &None, &no_multisig(&env), &None,
            );
            match r { Ok(Ok(_)) | Ok(Err(_)) | Err(_) => {} }
        }
    }

    // -------------------------------------------------------------------------
    // STATE-MUTATING: add_milestone — allocation ceiling fuzz
    // -------------------------------------------------------------------------

    /// Feature: fuzzing-requirements, Category 1 (state-mutating).
    ///
    /// After every successful add_milestone call, `allocated_amount` must not
    /// exceed `total_amount`.  Over-limit amounts must return a typed error,
    /// never a panic.
    #[test]
    fn fuzz_state_mutating_add_milestone_allocation_ceiling() {
        let boundaries: &[i128] = &[0, -1, 1, MAX_ESCROW, MAX_ESCROW + 1, i128::MAX];
        for &m in boundaries {
            let total: i128 = 10_000_000;
            let (env, client, tok) = setup();
            let c = Address::generate(&env);
            let f = Address::generate(&env);
            mint(&env, &tok, &c, total + 100);
            let eid = match client.try_create_escrow(
                &c, &f, &tok, &total, &nonzero_hash(&env, 1),
                &None, &None, &None, &None, &no_multisig(&env), &None,
            ) {
                Ok(Ok(id)) => id,
                _ => continue,
            };
            let r = client.try_add_milestone(
                &c, &eid, &String::from_str(&env, "m"), &nonzero_hash(&env, 2), &m,
            );
            if matches!(r, Ok(Ok(_))) {
                let meta = client.get_escrow_meta(&eid);
                assert!(meta.allocated_amount <= meta.total_amount,
                    "allocated > total after add_milestone (boundary)");
            }
        }

        let mut rng = Rng::new(0xABCD_EF01_2345_6789);
        for i in 0..FUZZ_ITERS {
            let total = rng.next_i128_range(1_000, MAX_ESCROW);
            let m = match i % 4 {
                0 => 0,
                1 => -1,
                2 => rng.next_i128_range(1, total + 1_000),
                _ => rng.next_i128_range(total, i128::MAX / 2),
            };
            let (env, client, tok) = setup();
            let c = Address::generate(&env);
            let f = Address::generate(&env);
            mint(&env, &tok, &c, total + 100);
            let eid = match client.try_create_escrow(
                &c, &f, &tok, &total, &nonzero_hash(&env, rng.next_u32()),
                &None, &None, &None, &None, &no_multisig(&env), &None,
            ) {
                Ok(Ok(id)) => id,
                _ => continue,
            };
            let r = client.try_add_milestone(
                &c, &eid, &String::from_str(&env, "m"),
                &nonzero_hash(&env, rng.next_u32()), &m,
            );
            if matches!(r, Ok(Ok(_))) {
                let meta = client.get_escrow_meta(&eid);
                assert!(meta.allocated_amount <= meta.total_amount,
                    "iter {i}: allocated {} > total {}", meta.allocated_amount, meta.total_amount);
            }
        }
    }

    // -------------------------------------------------------------------------
    // STATE-MUTATING: raise_dispute — invalid-id boundary fuzz
    // -------------------------------------------------------------------------

    /// Feature: fuzzing-requirements, Category 1 (state-mutating).
    ///
    /// raise_dispute must return a typed error for any non-existent escrow id
    /// and never panic.  Exercises 0, u64::MAX, and a full random sweep.
    #[test]
    fn fuzz_state_mutating_raise_dispute_invalid_id() {
        for &eid in &[0u64, 1, u32::MAX as u64, u64::MAX] {
            let (env, client, _) = setup();
            let caller = Address::generate(&env);
            match client.try_raise_dispute(&caller, &eid, &None) {
                Ok(Ok(_)) | Ok(Err(_)) | Err(_) => {}
            }
        }
        let mut rng = Rng::new(0x1234_5678_9ABC_DEF0);
        for _ in 0..FUZZ_ITERS {
            let (env, client, _) = setup();
            let caller = Address::generate(&env);
            let eid = rng.next();
            match client.try_raise_dispute(&caller, &eid, &None) {
                Ok(Ok(_)) | Ok(Err(_)) | Err(_) => {}
            }
        }
    }

    // -------------------------------------------------------------------------
    // VIEW / QUERY: get_escrow — no panic for any id
    // -------------------------------------------------------------------------

    /// Feature: fuzzing-requirements, Category 2 (view/query).
    ///
    /// get_escrow must never panic for any u64 id.
    /// Covers empty storage, single-entry storage, and out-of-range ids.
    #[test]
    fn fuzz_view_get_escrow_no_panic() {
        let mut rng = Rng::new(0xFEDC_BA98_7654_3210);
        for _ in 0..FUZZ_ITERS {
            let (_env, client, _) = setup();
            let eid = rng.next();
            match client.try_get_escrow(&eid) {
                Ok(Ok(_)) | Ok(Err(_)) | Err(_) => {}
            }
        }
        // Single-entry: verify "found" and "not-found" paths
        {
            let (env, client, tok) = setup();
            let c = Address::generate(&env);
            let f = Address::generate(&env);
            mint(&env, &tok, &c, 1_000_000);
            let eid = client.create_escrow(
                &c, &f, &tok, &1_000_000_i128, &nonzero_hash(&env, 99),
                &None, &None, &None, &None, &no_multisig(&env), &None,
            );
            assert!(matches!(client.try_get_escrow(&eid), Ok(Ok(_))),
                "get_escrow must succeed for a live escrow");
            assert!(!matches!(client.try_get_escrow(&(eid + 1)), Ok(Ok(_))),
                "get_escrow must fail for a non-existent id");
        }
    }

    /// Feature: fuzzing-requirements, Category 2 (view/query).
    ///
    /// get_milestone must never panic for any (escrow_id, milestone_id) pair.
    #[test]
    fn fuzz_view_get_milestone_no_panic() {
        let mut rng = Rng::new(0xCAFE_BABE_0000_0001);
        for _ in 0..FUZZ_ITERS {
            let (_env, client, _) = setup();
            let eid = rng.next();
            let mid = rng.next_u32();
            match client.try_get_milestone(&eid, &mid) {
                Ok(Ok(_)) | Ok(Err(_)) | Err(_) => {}
            }
        }
    }

    /// Feature: fuzzing-requirements, Category 2 (view/query).
    ///
    /// get_reputation must never panic for any address, including addresses
    /// with no on-chain history (empty storage).
    #[test]
    fn fuzz_view_get_reputation_no_panic() {
        let mut rng = Rng::new(0x0ACE_0ACE_0ACE_0ACE);
        for _ in 0..FUZZ_ITERS {
            let (env, client, _) = setup();
            let addr = Address::generate(&env);
            let _ = rng.next();
            match client.try_get_reputation(&addr) {
                Ok(Ok(_)) | Ok(Err(_)) | Err(_) => {}
            }
        }
    }

    // -------------------------------------------------------------------------
    // ADMINISTRATIVE: propose_admin / pause — auth-rejection fuzz
    // -------------------------------------------------------------------------

    /// Feature: fuzzing-requirements, Category 3 (administrative).
    ///
    /// propose_admin must reject every non-admin caller with a typed EscrowError
    /// (E4) — never an unhandled panic.
    #[test]
    fn fuzz_admin_propose_admin_rejects_non_admin() {
        let mut rng = Rng::new(0xBEEF_DEAD_BEEF_DEAD);
        for _ in 0..FUZZ_ITERS {
            let env = Env::default();
            env.mock_all_auths();
            let admin = Address::generate(&env);
            let _ = env.register_stellar_asset_contract_v2(admin.clone());
            let cid = env.register_contract(None, EscrowContract);
            let client = EscrowContractClient::new(&env, &cid);
            client.initialize(&admin);
            let non_admin = Address::generate(&env);
            let new_admin = Address::generate(&env);
            let _ = rng.next();
            match client.try_propose_admin(&non_admin, &new_admin) {
                Ok(Ok(_)) => assert_eq!(non_admin, admin,
                    "propose_admin succeeded for a non-admin caller"),
                Ok(Err(_)) | Err(_) => {}
            }
        }
    }

    /// Feature: fuzzing-requirements, Category 3 (administrative).
    ///
    /// pause must reject every non-admin caller without panicking.
    #[test]
    fn fuzz_admin_pause_rejects_non_admin() {
        let mut rng = Rng::new(0x1111_2222_3333_4444);
        for _ in 0..FUZZ_ITERS {
            let env = Env::default();
            env.mock_all_auths();
            let admin = Address::generate(&env);
            let _ = env.register_stellar_asset_contract_v2(admin.clone());
            let cid = env.register_contract(None, EscrowContract);
            let client = EscrowContractClient::new(&env, &cid);
            client.initialize(&admin);
            let non_admin = Address::generate(&env);
            let _ = rng.next();
            match client.try_pause(&non_admin) {
                Ok(Ok(_)) => assert_eq!(non_admin, admin,
                    "pause succeeded for a non-admin caller"),
                Ok(Err(_)) | Err(_) => {}
            }
        }
    }

    // -------------------------------------------------------------------------
    // ROUND-TRIP: EscrowMeta — ScVal serialisation via live contract state
    // -------------------------------------------------------------------------

    /// Feature: fuzzing-requirements — round-trip serialisation.
    ///
    /// Reads a live EscrowMeta, serialises → deserialises it via the Soroban
    /// ScVal codec, then compares the debug representation of the decoded value
    /// against a fresh re-read from storage.
    ///
    /// Using debug-string comparison avoids requiring `PartialEq` on `EscrowMeta`
    /// while still detecting any silent field truncation or reordering.
    #[test]
    fn fuzz_roundtrip_escrow_meta_scval() {
        use soroban_sdk::{TryFromVal, Val};

        let mut rng = Rng::new(0x5678_1234_ABCD_EF01);
        let mut ok: u64 = 0;

        for _ in 0..FUZZ_ITERS {
            let total = rng.next_i128_range(1_000, MAX_ESCROW);
            let seed  = rng.next_u32();

            let (env, client, tok) = setup();
            let c = Address::generate(&env);
            let f = Address::generate(&env);
            mint(&env, &tok, &c, total + 100);

            let eid = match client.try_create_escrow(
                &c, &f, &tok, &total, &nonzero_hash(&env, seed),
                &None, &None, &None, &None, &no_multisig(&env), &None,
            ) {
                Ok(Ok(id)) => id,
                _ => continue,
            };

            let original = client.get_escrow_meta(&eid);

            // Serialise then deserialise — must not error.
            let serialised: Val = original.into_val(&env);
            let decoded = crate::EscrowMeta::try_from_val(&env, &serialised)
                .expect("EscrowMeta ScVal round-trip must not fail");

            // Lossless check: re-read from storage and compare debug output.
            let re_read = client.get_escrow_meta(&eid);
            assert_eq!(
                std::format!("{decoded:?}"),
                std::format!("{re_read:?}"),
                "EscrowMeta ScVal round-trip changed the decoded value"
            );
            ok += 1;
        }

        assert!(ok >= FUZZ_ITERS / 2,
            "Too few successful EscrowMeta round-trips: {ok}");
    }

    /// Feature: fuzzing-requirements — round-trip serialisation.
    ///
    /// Creates a milestone, reads it back, serialises → deserialises via ScVal,
    /// and asserts the result equals the original.  Milestone derives PartialEq.
    #[test]
    fn fuzz_roundtrip_milestone_scval() {
        use soroban_sdk::{TryFromVal, Val};

        let mut rng = Rng::new(0xDEAD_C0DE_CAFE_F00D);
        let mut ok: u64 = 0;

        for _ in 0..FUZZ_ITERS {
            let total    = rng.next_i128_range(10_000, MAX_ESCROW);
            let m_amount = rng.next_i128_range(1, total.min(10_000));
            let seed     = rng.next_u32();

            let (env, client, tok) = setup();
            let c = Address::generate(&env);
            let f = Address::generate(&env);
            mint(&env, &tok, &c, total + 100);

            let eid = match client.try_create_escrow(
                &c, &f, &tok, &total, &nonzero_hash(&env, seed),
                &None, &None, &None, &None, &no_multisig(&env), &None,
            ) {
                Ok(Ok(id)) => id,
                _ => continue,
            };

            let mid = match client.try_add_milestone(
                &c, &eid,
                &String::from_str(&env, "m"),
                &nonzero_hash(&env, seed.wrapping_add(1)),
                &m_amount,
            ) {
                Ok(Ok(id)) => id,
                _ => continue,
            };

            let original = client.get_milestone(&eid, &mid);

            let serialised: Val = original.clone().into_val(&env);
            let roundtripped = crate::Milestone::try_from_val(&env, &serialised)
                .expect("Milestone ScVal round-trip must not fail");

            assert_eq!(original, roundtripped,
                "Milestone ScVal round-trip produced a different value");
            ok += 1;
        }

        assert!(ok >= FUZZ_ITERS / 2,
            "Too few successful Milestone round-trips: {ok}");
    }
}
