const STELLAR_TRANSACTION_HASH_PATTERN = /^[0-9a-fA-F]{64}$/;

export function isValidStellarTransactionHash(value) {
  return typeof value === 'string' && STELLAR_TRANSACTION_HASH_PATTERN.test(value);
}
