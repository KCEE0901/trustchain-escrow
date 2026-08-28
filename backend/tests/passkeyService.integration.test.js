/**
 * @fileoverview Integration test for passkeyService.js happy-path and lifecycle flows.
 * Exercises end-to-end passkey registration options, verification, authentication challenge,
 * verification, listing, and revocation in under 5 seconds.
 * @module tests/passkeyService.integration
 */

import { jest } from '@jest/globals';

const mockSimpleWebAuthn = {
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
};

jest.unstable_mockModule('@simplewebauthn/server', () => mockSimpleWebAuthn);

const { default: passkeyService } = await import('../services/passkeyService.js');

describe('Passkey Service End-to-End Integration Flow', () => {
  const mockUser = {
    id: 'user-integration-456',
    username: 'test_passkey_user',
    email: 'passkey@trustchain.local',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    passkeyService._clearStore();
  });

  it('should complete the full happy-path passkey lifecycle (registration -> auth -> listing -> revocation)', async () => {
    const startTime = Date.now();

    // 1. Generate Registration Options
    const mockChallenge = 'mock-reg-challenge-xyz-12345';
    mockSimpleWebAuthn.generateRegistrationOptions.mockResolvedValue({
      challenge: mockChallenge,
      rp: { name: 'TrustChain Escrow', id: 'localhost' },
      user: { id: mockUser.id, name: mockUser.username, displayName: mockUser.username },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      timeout: 60000,
      attestation: 'none',
      excludeCredentials: [],
    });

    const regOptions = await passkeyService.generatePasskeyRegistrationOptions(mockUser);
    expect(regOptions).toBeDefined();
    expect(regOptions.challenge).toBe(mockChallenge);
    expect(mockSimpleWebAuthn.generateRegistrationOptions).toHaveBeenCalledTimes(1);

    // 2. Verify Registration Response
    const mockCredentialId = 'cred-id-abc-789';
    const mockPublicKey = Buffer.from('mock-public-key-bytes');

    mockSimpleWebAuthn.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: mockCredentialId,
          publicKey: mockPublicKey,
          counter: 0,
        },
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
      },
    });

    const mockClientRegResponse = {
      id: mockCredentialId,
      rawId: mockCredentialId,
      response: {
        clientDataJSON: 'mock-client-data',
        attestationObject: 'mock-attestation',
        transports: ['internal', 'hybrid'],
      },
      type: 'public-key',
    };

    const regResult = await passkeyService.verifyPasskeyRegistration(
      mockUser.id,
      mockClientRegResponse,
      'MacBook TouchID',
    );

    expect(regResult.verified).toBe(true);
    expect(regResult.credential.id).toBe(mockCredentialId);
    expect(regResult.credential.deviceName).toBe('MacBook TouchID');

    // 3. List Registered Passkeys
    const userPasskeys = passkeyService.getUserPasskeys(mockUser.id);
    expect(userPasskeys).toHaveLength(1);
    expect(userPasskeys[0].id).toBe(mockCredentialId);
    expect(userPasskeys[0].deviceName).toBe('MacBook TouchID');

    // 4. Generate Authentication Options
    const mockAuthChallenge = 'mock-auth-challenge-qwe-67890';
    mockSimpleWebAuthn.generateAuthenticationOptions.mockResolvedValue({
      challenge: mockAuthChallenge,
      timeout: 60000,
      rpId: 'localhost',
      allowCredentials: [{ id: mockCredentialId, type: 'public-key' }],
      userVerification: 'preferred',
    });

    const authOptions = await passkeyService.generatePasskeyAuthenticationOptions(mockUser.id);
    expect(authOptions).toBeDefined();
    expect(authOptions.challenge).toBe(mockAuthChallenge);
    expect(mockSimpleWebAuthn.generateAuthenticationOptions).toHaveBeenCalledTimes(1);

    // 5. Verify Authentication Response
    mockSimpleWebAuthn.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: {
        newCounter: 1,
      },
    });

    const mockClientAuthResponse = {
      id: mockCredentialId,
      rawId: mockCredentialId,
      response: {
        clientDataJSON: 'mock-auth-client-data',
        authenticatorData: 'mock-auth-data',
        signature: 'mock-signature',
        userHandle: mockUser.id,
      },
      type: 'public-key',
    };

    const authResult = await passkeyService.verifyPasskeyAuthentication(
      mockUser.id,
      mockClientAuthResponse,
    );

    expect(authResult.verified).toBe(true);
    expect(authResult.userId).toBe(mockUser.id);
    expect(authResult.credentialId).toBe(mockCredentialId);

    // 6. Revoke Passkey
    const revoked = passkeyService.revokePasskey(mockUser.id, mockCredentialId);
    expect(revoked).toBe(true);

    const remainingPasskeys = passkeyService.getUserPasskeys(mockUser.id);
    expect(remainingPasskeys).toHaveLength(0);

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(5000); // Must run in under 5s
  });

  it('should reject authentication if no passkeys are registered', async () => {
    await expect(
      passkeyService.generatePasskeyAuthenticationOptions('unknown-user-999'),
    ).rejects.toThrow('No registered passkeys found for user');
  });

  it('should reject verification when challenge is missing or expired', async () => {
    await expect(
      passkeyService.verifyPasskeyRegistration('user-no-challenge', { id: 'any' }),
    ).rejects.toThrow('Registration challenge expired or not found');
  });
});
