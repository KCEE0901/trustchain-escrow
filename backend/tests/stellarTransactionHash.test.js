import { isValidStellarTransactionHash } from '../../shared/stellarTransactionHash.js';

describe('isValidStellarTransactionHash', () => {
  it.each(['a'.repeat(64), 'A'.repeat(64)])(
    'accepts a 64-character hexadecimal hash: %s',
    (hash) => {
      expect(isValidStellarTransactionHash(hash)).toBe(true);
    },
  );

  it.each(['', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), null, 123])(
    'rejects malformed hash: %s',
    (hash) => {
      expect(isValidStellarTransactionHash(hash)).toBe(false);
    },
  );
});
