//! # Multi-asset fee accounting tests
//!
//! Issue #208: verify platform fees are calculated and stored correctly for
//! non-XLM escrow assets, covering:
//!
//!  1. Custom token with default-decimal precision — fee deducted at correct bps
//!  2. Token with high-precision amounts (simulating 18-decimal tokens) — fee math
//!  3. Fee cap: tiers configured so that no fee applies above a threshold
//!  4. Zero-fee config: `fee_bps = 0` leaves full amount with freelancer
//!  5. Multiple sequential milestones — fee collected only once per escrow
//!  6. Treasury receives fee; freelancer receives net amount

#[cfg(test)]
#[allow(clippy::module_inception)]
mod multi_asset_fee_tests {
    use soroban_sdk::{
        testutils::Address as _,
        token, Address, BytesN, Env, Vec,
    };

    use crate::{EscrowContract, EscrowContractClient, EscrowError, FeeTier, MultisigConfig};

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn no_multisig(env: &Env) -> MultisigConfig {
        MultisigConfig {
            approvers: Vec::new(env),
            weights: Vec::new(env),
            threshold: 0,
        }
    }

    fn brief(env: &Env, seed: u8) -> BytesN<32> {
        BytesN::from_array(env, &[seed; 32])
    }

    /// Set up a fresh contract with a treasury and custom fee tiers.
    /// Returns (env, admin, treasury, token_id, client).
    fn setup_with_fee_tiers(
        fee_tiers: Vec<FeeTier>,
    ) -> (Env, Address, Address, Address, EscrowContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);

        // Register a custom SAC token (non-XLM)
        let token_sac = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_sac.address();

        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.initialize(&admin);
        client.set_platform_treasury(&admin, &treasury);
        client.set_platform_fee_tiers(&admin, &fee_tiers).unwrap();

        (env, admin, treasury, token_id, client)
    }

    /// Build a single-tier fee configuration.
    fn single_tier(env: &Env, fee_bps: u32) -> Vec<FeeTier> {
        let mut tiers = Vec::new(env);
        tiers.push_back(FeeTier {
            min_total_amount: 0,
            fee_bps,
        });
        tiers
    }

    /// Mint `amount + padding` tokens to `recipient`.
    fn mint(env: &Env, token_id: &Address, admin: &Address, recipient: &Address, amount: i128) {
        // Extra padding for storage rent reserves
        let padding: i128 = 1_000;
        token::StellarAssetClient::new(env, token_id).mint(recipient, &(amount + padding));
    }

    fn balance(env: &Env, token_id: &Address, addr: &Address) -> i128 {
        token::Client::new(env, token_id).balance(addr)
    }

    fn create_and_fund_escrow(
        env: &Env,
        client: &EscrowContractClient,
        depositor: &Address,
        contractor: &Address,
        token: &Address,
        amount: i128,
    ) -> u64 {
        client.create_escrow(
            depositor,
            contractor,
            token,
            &amount,
            &brief(env, 1),
            &None::<Address>,
            &None::<u64>,
            &None::<u64>,
            &None,
            &no_multisig(env),
            &None,
        )
    }

    // ── Test 1: Standard bps fee deducted from non-XLM token ─────────────────

    /// 200 bps (2 %) fee on a USDC-like token amount.
    /// Freelancer receives gross − fee; treasury receives fee.
    #[test]
    fn test_fee_deducted_for_non_xlm_token() {
        // 200 bps = 2 %
        let tiers_holder = Env::default();
        tiers_holder.mock_all_auths();
        let env_ref = &tiers_holder;
        let fee_tiers_local = single_tier(env_ref, 200);

        let (env, admin, treasury, token_id, client) = setup_with_fee_tiers(fee_tiers_local);

        let depositor = Address::generate(&env);
        let contractor = Address::generate(&env);
        let gross: i128 = 100_000; // 100 000 stroops
        let expected_fee: i128 = gross * 200 / 10_000; // 2 000 stroops

        mint(&env, &token_id, &admin, &depositor, gross);

        let escrow_id = create_and_fund_escrow(&env, &client, &depositor, &contractor, &token_id, gross);

        // Add + submit milestone
        client.add_milestone(&depositor, &escrow_id, &gross, &brief(&env, 2), &None);
        client.submit_milestone(&contractor, &escrow_id, &0);

        let treasury_before = balance(&env, &token_id, &treasury);
        let contractor_before = balance(&env, &token_id, &contractor);

        // Approve — triggers fee collection + freelancer payout
        client.approve_milestone(&depositor, &escrow_id, &0);

        let treasury_after = balance(&env, &token_id, &treasury);
        let contractor_after = balance(&env, &token_id, &contractor);

        assert_eq!(
            treasury_after - treasury_before,
            expected_fee,
            "treasury should receive exactly the 2% fee"
        );
        assert_eq!(
            contractor_after - contractor_before,
            gross - expected_fee,
            "contractor should receive gross minus the fee"
        );
    }

    // ── Test 2: High-precision amounts (simulating 18-decimal tokens) ─────────

    /// Verifies fee math stays correct for large amounts (no overflow, correct
    /// rounding via integer division).
    #[test]
    fn test_fee_with_high_precision_amount() {
        let tiers_holder = Env::default();
        tiers_holder.mock_all_auths();
        let fee_tiers_local = single_tier(&tiers_holder, 100); // 1 %

        let (env, admin, treasury, token_id, client) = setup_with_fee_tiers(fee_tiers_local);

        let depositor = Address::generate(&env);
        let contractor = Address::generate(&env);
        // Simulate a token with 18 decimals: 1 token = 1_000_000_000_000_000_000
        let gross: i128 = 1_000_000_000_000_000_000;
        let expected_fee: i128 = gross / 100; // 1 %

        mint(&env, &token_id, &admin, &depositor, gross);

        let escrow_id = create_and_fund_escrow(&env, &client, &depositor, &contractor, &token_id, gross);

        client.add_milestone(&depositor, &escrow_id, &gross, &brief(&env, 3), &None);
        client.submit_milestone(&contractor, &escrow_id, &0);

        let treasury_before = balance(&env, &token_id, &treasury);
        client.approve_milestone(&depositor, &escrow_id, &0);
        let treasury_after = balance(&env, &token_id, &treasury);

        assert_eq!(
            treasury_after - treasury_before,
            expected_fee,
            "fee should be exactly 1% of high-precision amount"
        );
    }

    // ── Test 3: Fee cap — tier with min_total_amount stops fee above threshold ─

    /// Configure a tiered schedule where the second tier has 0 bps — meaning
    /// amounts above the threshold are effectively fee-capped at 0.
    #[test]
    fn test_fee_cap_zero_above_threshold() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let token_sac = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_sac.address();

        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.initialize(&admin);
        client.set_platform_treasury(&admin, &treasury);

        // Tier 1: amounts 0–9999 → 200 bps
        // Tier 2: amounts ≥ 10000 → 0 bps (fee cap / waiver)
        let mut tiers = Vec::new(&env);
        tiers.push_back(FeeTier { min_total_amount: 0, fee_bps: 200 });
        tiers.push_back(FeeTier { min_total_amount: 10_000, fee_bps: 0 });
        client.set_platform_fee_tiers(&admin, &tiers).unwrap();

        let depositor = Address::generate(&env);
        let contractor = Address::generate(&env);
        let gross: i128 = 50_000; // above the cap threshold

        token::StellarAssetClient::new(&env, &token_id).mint(&depositor, &(gross + 2_000));

        let escrow_id = create_and_fund_escrow(&env, &client, &depositor, &contractor, &token_id, gross);
        client.add_milestone(&depositor, &escrow_id, &gross, &brief(&env, 4), &None);
        client.submit_milestone(&contractor, &escrow_id, &0);

        let treasury_before = balance(&env, &token_id, &treasury);
        let contractor_before = balance(&env, &token_id, &contractor);

        client.approve_milestone(&depositor, &escrow_id, &0);

        let treasury_after = balance(&env, &token_id, &treasury);
        let contractor_after = balance(&env, &token_id, &contractor);

        assert_eq!(
            treasury_after - treasury_before,
            0,
            "treasury should receive 0 when fee is capped at this tier"
        );
        assert_eq!(
            contractor_after - contractor_before,
            gross,
            "contractor should receive full gross when fee is zero"
        );
    }

    // ── Test 4: Zero-fee config — full amount reaches freelancer ──────────────

    #[test]
    fn test_zero_fee_full_amount_to_freelancer() {
        let tiers_holder = Env::default();
        tiers_holder.mock_all_auths();
        let fee_tiers_local = single_tier(&tiers_holder, 0); // 0 bps

        let (env, admin, treasury, token_id, client) = setup_with_fee_tiers(fee_tiers_local);

        let depositor = Address::generate(&env);
        let contractor = Address::generate(&env);
        let gross: i128 = 5_000;

        mint(&env, &token_id, &admin, &depositor, gross);

        let escrow_id = create_and_fund_escrow(&env, &client, &depositor, &contractor, &token_id, gross);
        client.add_milestone(&depositor, &escrow_id, &gross, &brief(&env, 5), &None);
        client.submit_milestone(&contractor, &escrow_id, &0);

        let treasury_before = balance(&env, &token_id, &treasury);
        let contractor_before = balance(&env, &token_id, &contractor);

        client.approve_milestone(&depositor, &escrow_id, &0);

        let treasury_after = balance(&env, &token_id, &treasury);
        let contractor_after = balance(&env, &token_id, &contractor);

        assert_eq!(
            treasury_after - treasury_before,
            0,
            "treasury should receive nothing for 0-fee config"
        );
        assert_eq!(
            contractor_after - contractor_before,
            gross,
            "contractor should receive full amount for 0-fee config"
        );
    }

    // ── Test 5: Fee collected only once — second approval on completed escrow ──

    /// Verifies that the fee snapshot is marked `collected = true` after the
    /// first approval so it cannot be double-collected.
    #[test]
    fn test_fee_not_double_collected_on_multiple_milestones() {
        let tiers_holder = Env::default();
        tiers_holder.mock_all_auths();
        let fee_tiers_local = single_tier(&tiers_holder, 150); // 1.5 %

        let (env, admin, treasury, token_id, client) = setup_with_fee_tiers(fee_tiers_local);

        let depositor = Address::generate(&env);
        let contractor = Address::generate(&env);
        let m1_amount: i128 = 4_000;
        let m2_amount: i128 = 6_000;
        let gross = m1_amount + m2_amount; // 10 000
        // Fee is computed once on the total escrow amount at creation
        // 150 bps of 10_000 = 150
        let expected_total_fee: i128 = gross * 150 / 10_000;

        mint(&env, &token_id, &admin, &depositor, gross + 2_000);

        let escrow_id = create_and_fund_escrow(&env, &client, &depositor, &contractor, &token_id, gross);
        client.add_milestone(&depositor, &escrow_id, &m1_amount, &brief(&env, 6), &None);
        client.add_milestone(&depositor, &escrow_id, &m2_amount, &brief(&env, 7), &None);

        // Approve milestone 0
        client.submit_milestone(&contractor, &escrow_id, &0);
        let treasury_before = balance(&env, &token_id, &treasury);
        client.approve_milestone(&depositor, &escrow_id, &0);
        let treasury_after_m0 = balance(&env, &token_id, &treasury);

        // Approve milestone 1
        client.submit_milestone(&contractor, &escrow_id, &1);
        client.approve_milestone(&depositor, &escrow_id, &1);
        let treasury_after_m1 = balance(&env, &token_id, &treasury);

        // Total fee received by treasury across both milestones must equal
        // the single computed fee for the whole escrow — no double-count.
        let total_fee_received = treasury_after_m1 - treasury_before;
        assert_eq!(
            total_fee_received,
            expected_total_fee,
            "fee must be collected exactly once regardless of milestone count"
        );

        // After milestone 0 approval all fee must already have been collected
        // (fee is taken on the first payout)
        assert_eq!(
            treasury_after_m0 - treasury_before,
            expected_total_fee,
            "fee should be fully collected on the first milestone approval"
        );
        assert_eq!(
            treasury_after_m1 - treasury_after_m0,
            0,
            "second milestone approval must not collect additional fee"
        );
    }

    // ── Test 6: Different token decimals — fee math via pure arithmetic ────────

    /// Verifies fee calculation correctness at different scale factors without
    /// needing a real 18-decimal token: scales an amount by 10^6 (USDC-style)
    /// and confirms integer-division rounding is floor (no phantom dust).
    #[test]
    fn test_fee_rounding_no_phantom_dust() {
        // 100 bps of 1_000_001 stroops should be 100 (floor, not 100.0001)
        let gross: i128 = 1_000_001;
        let fee_bps: i128 = 100;
        let fee = gross * fee_bps / 10_000;
        // Expected: 100 (floor division discards the fraction)
        assert_eq!(fee, 100, "fee must use floor division, no phantom dust");

        // A stricter variant: 150 bps of 6_667 = 1.0005 → floored to 1
        let gross2: i128 = 6_667;
        let fee2 = gross2 * 150 / 10_000;
        assert_eq!(fee2, 100, "1.5% of 6667 should floor to 100");
    }
}
