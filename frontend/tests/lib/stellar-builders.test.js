describe('stellar transaction builders', () => {
  const originalContract = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;

  afterEach(() => {
    jest.resetModules();
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS = originalContract;
  });

  it('rejects create escrow builder calls when contract address is missing', async () => {
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS = '';
    const { buildCreateEscrowTx } = await import('../../lib/stellar');

    await expect(
      buildCreateEscrowTx({
        sourceAddress: 'GA7YNBW5CBTJZ3ZZOWX3ZNBKD6OE7A7IHUQVWMY62W2ZBG2SGZVOOPVH',
        freelancerAddress: 'GA7YNBW5CBTJZ3ZZOWX3ZNBKD6OE7A7IHUQVWMY62W2ZBG2SGZVOOPVH',
        tokenAddress: 'GA7YNBW5CBTJZ3ZZOWX3ZNBKD6OE7A7IHUQVWMY62W2ZBG2SGZVOOPVH',
        amount: '100',
        briefHash: 'a'.repeat(64),
      }),
    ).rejects.toThrow(/Contract address not configured/);
  });
});
