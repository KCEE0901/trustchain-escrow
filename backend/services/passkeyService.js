/**
 * @fileoverview Passkey (WebAuthn / FIDO2) authentication service.
 * Handles credential registration options generation, registration verification,
 * authentication challenges, assertion verification, and passkey credential lifecycle management.
 * @module services/passkeyService
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { createModuleLogger } from '../config/logger.js';

const logger = createModuleLogger('passkeyService');

// In-memory / mock store for passkeys and challenges (can be backed by DB)
const passkeyStore = new Map(); // userId -> Array<PasskeyCredential>
const challengeStore = new Map(); // userId -> { challenge: string, expiresAt: number }

const RP_NAME = process.env.PASSKEY_RP_NAME || 'TrustChain Escrow';
const RP_ID = process.env.PASSKEY_RP_ID || 'localhost';
const EXPECTED_ORIGIN = process.env.PASSKEY_ORIGIN || 'http://localhost:3000';

/**
 * Generates WebAuthn registration options for a user registering a new passkey.
 *
 * @async
 * @function generatePasskeyRegistrationOptions
 * @param {Object} user - User object with id and username/email.
 * @param {string} user.id - Unique user identifier.
 * @param {string} [user.username] - User display name or email.
 * @returns {Promise<Object>} WebAuthn PublicKeyCredentialCreationOptionsJSON.
 */
export async function generatePasskeyRegistrationOptions(user) {
  if (!user || !user.id) {
    throw new Error('Valid user object with an ID is required');
  }

  const existingPasskeys = passkeyStore.get(user.id) || [];
  const excludeCredentials = existingPasskeys.map((cred) => ({
    id: cred.id,
    type: 'public-key',
    transports: cred.transports,
  }));

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: Buffer.from(user.id),
    userName: user.username || user.email || `user_${user.id}`,
    userDisplayName: user.username || user.name || 'TrustChain User',
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  // Store challenge for verification
  challengeStore.set(user.id, {
    challenge: options.challenge,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 min expiry
  });

  logger.info(`[PasskeyService] Generated registration options for user ${user.id}`);
  return options;
}

/**
 * Verifies a WebAuthn registration response and stores the newly created passkey.
 *
 * @async
 * @function verifyPasskeyRegistration
 * @param {string} userId - ID of the user registering the passkey.
 * @param {Object} registrationResponse - WebAuthn registration credential payload from client.
 * @param {string} [deviceName='Passkey'] - Optional friendly device name.
 * @returns {Promise<{ verified: boolean, credential?: Object }>} Verification result and stored credential.
 */
export async function verifyPasskeyRegistration(
  userId,
  registrationResponse,
  deviceName = 'Passkey',
) {
  const challengeData = challengeStore.get(userId);
  if (!challengeData || Date.now() > challengeData.expiresAt) {
    throw new Error('Registration challenge expired or not found');
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: registrationResponse,
      expectedChallenge: challengeData.challenge,
      expectedOrigin: EXPECTED_ORIGIN,
      expectedRPID: RP_ID,
    });
  } catch (err) {
    logger.error('[PasskeyService] Registration verification failed:', err);
    throw new Error(`Passkey registration verification failed: ${err.message}`);
  }

  if (verification.verified && verification.registrationInfo) {
    const { credential } = verification.registrationInfo;

    const newPasskey = {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64'),
      counter: credential.counter,
      transports: registrationResponse.response?.transports || ['internal'],
      deviceName,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };

    const userPasskeys = passkeyStore.get(userId) || [];
    userPasskeys.push(newPasskey);
    passkeyStore.set(userId, userPasskeys);
    challengeStore.delete(userId);

    logger.info(`[PasskeyService] Successfully registered passkey for user ${userId}`);

    return {
      verified: true,
      credential: {
        id: newPasskey.id,
        deviceName: newPasskey.deviceName,
        createdAt: newPasskey.createdAt,
      },
    };
  }

  return { verified: false };
}

/**
 * Generates WebAuthn authentication (assertion) options for a user logging in.
 *
 * @async
 * @function generatePasskeyAuthenticationOptions
 * @param {string} userId - User identifier.
 * @returns {Promise<Object>} WebAuthn PublicKeyCredentialRequestOptionsJSON.
 */
export async function generatePasskeyAuthenticationOptions(userId) {
  if (!userId) {
    throw new Error('User ID is required');
  }

  const userPasskeys = passkeyStore.get(userId) || [];
  if (userPasskeys.length === 0) {
    throw new Error('No registered passkeys found for user');
  }

  const allowCredentials = userPasskeys.map((cred) => ({
    id: cred.id,
    type: 'public-key',
    transports: cred.transports,
  }));

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials,
    userVerification: 'preferred',
  });

  challengeStore.set(userId, {
    challenge: options.challenge,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  logger.info(`[PasskeyService] Generated authentication options for user ${userId}`);
  return options;
}

/**
 * Verifies a WebAuthn authentication response against stored passkey credentials.
 *
 * @async
 * @function verifyPasskeyAuthentication
 * @param {string} userId - User identifier.
 * @param {Object} authResponse - WebAuthn authentication credential payload from client.
 * @returns {Promise<{ verified: boolean, userId: string, credentialId?: string }>} Authentication result.
 */
export async function verifyPasskeyAuthentication(userId, authResponse) {
  const challengeData = challengeStore.get(userId);
  if (!challengeData || Date.now() > challengeData.expiresAt) {
    throw new Error('Authentication challenge expired or not found');
  }

  const userPasskeys = passkeyStore.get(userId) || [];
  const credential = userPasskeys.find((p) => p.id === authResponse.id);

  if (!credential) {
    throw new Error('Passkey credential not found for this account');
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: authResponse,
      expectedChallenge: challengeData.challenge,
      expectedOrigin: EXPECTED_ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey, 'base64'),
        counter: credential.counter,
        transports: credential.transports,
      },
    });
  } catch (err) {
    logger.error('[PasskeyService] Authentication verification failed:', err);
    throw new Error(`Passkey authentication verification failed: ${err.message}`);
  }

  if (verification.verified) {
    credential.counter = verification.authenticationInfo.newCounter;
    credential.lastUsedAt = new Date().toISOString();
    challengeStore.delete(userId);

    logger.info(`[PasskeyService] Successfully authenticated user ${userId} with passkey`);

    return {
      verified: true,
      userId,
      credentialId: credential.id,
    };
  }

  return { verified: false, userId };
}

/**
 * Retrieves all registered passkeys for a user (without sensitive public keys).
 *
 * @function getUserPasskeys
 * @param {string} userId - User identifier.
 * @returns {Array<Object>} List of registered passkey summaries.
 */
export function getUserPasskeys(userId) {
  const passkeys = passkeyStore.get(userId) || [];
  return passkeys.map((p) => ({
    id: p.id,
    deviceName: p.deviceName,
    createdAt: p.createdAt,
    lastUsedAt: p.lastUsedAt,
    transports: p.transports,
  }));
}

/**
 * Revokes and deletes a registered passkey.
 *
 * @function revokePasskey
 * @param {string} userId - User identifier.
 * @param {string} credentialId - ID of passkey credential to delete.
 * @returns {boolean} True if passkey was found and deleted.
 */
export function revokePasskey(userId, credentialId) {
  const passkeys = passkeyStore.get(userId) || [];
  const filtered = passkeys.filter((p) => p.id !== credentialId);
  const existed = filtered.length < passkeys.length;

  if (existed) {
    passkeyStore.set(userId, filtered);
    logger.info(`[PasskeyService] Revoked passkey ${credentialId} for user ${userId}`);
  }

  return existed;
}

/**
 * Clears in-memory test store (useful for test teardown).
 * @function _clearStore
 */
export function _clearStore() {
  passkeyStore.clear();
  challengeStore.clear();
}

export default {
  generatePasskeyRegistrationOptions,
  verifyPasskeyRegistration,
  generatePasskeyAuthenticationOptions,
  verifyPasskeyAuthentication,
  getUserPasskeys,
  revokePasskey,
  _clearStore,
};
