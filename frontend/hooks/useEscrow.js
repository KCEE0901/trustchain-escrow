'use client';

import useSWR from 'swr';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/**
 * Fetches a URL and returns the parsed JSON body.
 *
 * On a non-OK HTTP response the fetcher throws an Error whose message
 * contains the HTTP status code and the server's `error` field (if any),
 * so callers can display a meaningful message without leaking secrets or
 * auth tokens.
 *
 * @param {string} url
 * @returns {Promise<any>}
 */
async function fetcher(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (networkErr) {
    // Surface network-level failures (offline, DNS, CORS) with clear context.
    throw new Error(`Network request failed for ${new URL(url).pathname}: ${networkErr.message}`);
  }

  if (!response.ok) {
    // Parse the body for a server-supplied reason without trusting it blindly.
    let reason = '';
    try {
      const body = await response.json();
      // Only include safe, non-sensitive fields from the response body.
      if (typeof body?.error === 'string') reason = body.error;
      else if (typeof body?.message === 'string') reason = body.message;
    } catch {
      // Body is not JSON — use the HTTP status text instead.
      reason = response.statusText;
    }

    const path = new URL(url).pathname;
    const detail = reason ? `: ${reason}` : '';
    throw new Error(`Failed to fetch ${path} (HTTP ${response.status}${detail})`);
  }

  return response.json();
}

/**
 * Fetch a single escrow by ID.
 * Polls every 30 seconds; pauses automatically when the page is hidden.
 *
 * Errors now include the HTTP status code and the server-provided reason so
 * callers can display "Failed to fetch /api/escrows/42 (HTTP 404: Not found)"
 * instead of a generic "Internal error".
 *
 * @param {number|string} id — escrow_id
 * @returns {{ escrow: object|null, isLoading: boolean, error: Error|null, mutate: Function }}
 */
export function useEscrow(id) {
  const { data, error, isLoading, mutate } = useSWR(
    id != null && id !== '' ? `${API_URL}/api/escrows/${id}` : null,
    fetcher,
    {
      refreshInterval: 30_000, // poll every 30 seconds
      refreshWhenHidden: false, // pause polling when page is not visible
    },
  );
  return { escrow: data ?? null, isLoading, error: error ?? null, mutate };
}

/**
 * Fetch all escrows for the connected user.
 *
 * @param {string} address — Stellar public key
 * @param {'client'|'freelancer'|'all'} role
 * @returns {{ escrows: Array, isLoading: boolean, error: Error|null }}
 *
 * TODO (contributor — Issue #39)
 */
export function useUserEscrows(_address, _role = 'all') {
  // TODO: implement with SWR
  return { escrows: [], isLoading: false, error: null };
}

/**
 * Fetch paginated list of all escrows (for Explorer).
 *
 * @param {{ page: number, limit: number, status: string }} options
 *
 * TODO (contributor — Issue #39)
 */
export function useEscrowList({ page: _page = 1, limit: _limit = 20, status: _status = '' } = {}) {
  // TODO: implement with SWR
  return { escrows: [], total: 0, isLoading: false, error: null };
}
