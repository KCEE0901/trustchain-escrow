pub fn referral_account_key(account_id: &str) -> String {
    format!("referral:account:{account_id}")
}

pub fn referral_stats_key(account_id: &str) -> String {
    format!("referral:stats:{account_id}")
}
