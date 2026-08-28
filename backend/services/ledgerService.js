/**
 * @fileoverview Ledger service for querying Stellar ledger transactions, parsing payment/escrow operations,
 * managing cursor pagination, and providing keyboard-driven navigation helpers for CLI/interactive tools.
 * @module services/ledgerService
 */

import { createModuleLogger } from '../config/logger.js';

const logger = createModuleLogger('ledgerService');

const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';

/**
 * Key definitions for keyboard navigation operations.
 * @enum {string}
 */
export const KEY_CODES = {
  ENTER: 'Enter',
  ESCAPE: 'Escape',
  TAB: 'Tab',
  ARROW_DOWN: 'ArrowDown',
  ARROW_UP: 'ArrowUp',
  SPACE: ' ',
  HOME: 'Home',
  END: 'End',
};

/**
 * Classifies a raw Horizon transaction operation into domain types.
 *
 * @function classifyOperation
 * @param {Object} op - Raw operation object from Horizon API.
 * @returns {string} Operation domain category (deposit, escrow_creation, milestone_approval, dispute, reward).
 */
export function classifyOperation(op) {
  if (!op || !op.type) return 'deposit';
  const type = op.type;

  if (type === 'create_account' || type === 'payment') return 'deposit';
  if (type === 'manage_data') {
    const name = (op.name || '').toLowerCase();
    if (name.includes('escrow')) return 'escrow_creation';
    if (name.includes('milestone') || name.includes('approve')) return 'milestone_approval';
    if (name.includes('dispute')) return 'dispute';
    if (name.includes('reward')) return 'reward';
  }
  return 'deposit';
}

/**
 * Handles keyboard navigation events for ledger transaction lists.
 *
 * @function handleLedgerKeyNavigation
 * @param {Object} event - Keyboard event payload.
 * @param {string} event.key - Key value (e.g. 'ArrowDown', 'ArrowUp', 'Enter', 'Escape').
 * @param {number} currentIndex - Currently focused index.
 * @param {number} totalItems - Total count of navigable items.
 * @param {Object} [options={}] - Additional navigation state.
 * @param {string|null} [options.expandedId=null] - ID of currently expanded item.
 * @returns {{ nextIndex: number, action: string, shouldPreventDefault: boolean }} Navigation outcome.
 *
 * @example
 * const result = handleLedgerKeyNavigation({ key: 'ArrowDown' }, 0, 10);
 * console.log(`Move focus to index ${result.nextIndex}`);
 */
export function handleLedgerKeyNavigation(event, currentIndex, totalItems, options = {}) {
  const key = event?.key;
  if (!key || totalItems <= 0) {
    return { nextIndex: currentIndex, action: 'none', shouldPreventDefault: false };
  }

  switch (key) {
    case KEY_CODES.ARROW_DOWN:
      return {
        nextIndex: (currentIndex + 1) % totalItems,
        action: 'focus_next',
        shouldPreventDefault: true,
      };

    case KEY_CODES.ARROW_UP:
      return {
        nextIndex: (currentIndex - 1 + totalItems) % totalItems,
        action: 'focus_previous',
        shouldPreventDefault: true,
      };

    case KEY_CODES.HOME:
      return {
        nextIndex: 0,
        action: 'focus_first',
        shouldPreventDefault: true,
      };

    case KEY_CODES.END:
      return {
        nextIndex: totalItems - 1,
        action: 'focus_last',
        shouldPreventDefault: true,
      };

    case KEY_CODES.ENTER:
    case KEY_CODES.SPACE:
      return {
        nextIndex: currentIndex,
        action: 'toggle_expand',
        shouldPreventDefault: true,
      };

    case KEY_CODES.ESCAPE:
      return {
        nextIndex: currentIndex,
        action: 'collapse',
        shouldPreventDefault: true,
      };

    case KEY_CODES.TAB:
      return {
        nextIndex: currentIndex,
        action: 'tab_navigate',
        shouldPreventDefault: false,
      };

    default:
      return {
        nextIndex: currentIndex,
        action: 'none',
        shouldPreventDefault: false,
      };
  }
}

/**
 * Fetches and formats ledger operations for a given Stellar account address.
 *
 * @async
 * @function fetchAccountLedgerOperations
 * @param {string} accountAddress - Stellar public key.
 * @param {Object} [options={}] - Pagination and ordering options.
 * @param {string} [options.cursor] - Horizon paging cursor.
 * @param {number} [options.limit=20] - Number of records per page.
 * @param {string} [options.order='desc'] - Sort order ('asc' | 'desc').
 * @returns {Promise<{ records: Array<Object>, nextCursor: string|null, hasMore: boolean }>} Formatted transaction records.
 */
export async function fetchAccountLedgerOperations(accountAddress, options = {}) {
  if (!accountAddress) {
    throw new Error('Account address is required');
  }

  const { cursor = null, limit = 20, order = 'desc' } = options;
  const params = new URLSearchParams({
    limit: limit.toString(),
    order,
  });
  if (cursor) params.set('cursor', cursor);

  try {
    const res = await fetch(`${HORIZON_URL}/accounts/${accountAddress}/operations?${params}`);
    if (!res.ok) {
      throw new Error(`Horizon API returned status ${res.status}`);
    }

    const data = await res.json();
    const rawRecords = data._embedded?.records || [];

    const records = rawRecords.map((op) => ({
      id: op.id,
      type: classifyOperation(op),
      rawType: op.type,
      date: op.created_at,
      amount: op.amount || null,
      status: op.transaction_successful !== false ? 'success' : 'failed',
      transactionHash: op.transaction_hash,
      operationId: op.id,
      from: op.from,
      to: op.to,
      name: op.name,
      value: op.value,
    }));

    let nextCursor = null;
    const nextLink = data._links?.next?.href;
    if (nextLink) {
      nextCursor = new URL(nextLink).searchParams.get('cursor');
    }

    return {
      records,
      nextCursor,
      hasMore: rawRecords.length >= limit,
    };
  } catch (err) {
    logger.error(`[LedgerService] Failed to fetch operations for ${accountAddress}:`, err);
    throw err;
  }
}

export default {
  KEY_CODES,
  classifyOperation,
  handleLedgerKeyNavigation,
  fetchAccountLedgerOperations,
};
