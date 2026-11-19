'use client';

import useSWR from 'swr';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const fetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    const err = new Error(`Request failed (${response.status})`);
    err.status = response.status;
    throw err;
  }
  return response.json();
};

/**
 * Fetch a single escrow by ID.
 * Polls every 30 seconds; pauses automatically when the page is hidden.
 *
 * @param {number|string} id — escrow_id
 * @returns {{ escrow: object|null, isLoading: boolean, error: Error|null, mutate: Function }}
 */
export function useEscrow(id) {
  const { data, error, isLoading, mutate } = useSWR(
    id ? `${API_URL}/api/escrows/${id}` : null,
    fetcher,
    {
      refreshInterval: 30_000,
      refreshWhenHidden: false,
    },
  );
  return { escrow: data, isLoading, error, mutate };
}

/**
 * Fetch all escrows for the connected user.
 *
 * @param {string} address — Stellar public key
 * @param {'client'|'freelancer'|'all'} role
 * @returns {{ escrows: Array, isLoading: boolean, error: Error|null }}
 */
export function useUserEscrows(address, role = 'all') {
  const query = new URLSearchParams({ role });
  const { data, error, isLoading } = useSWR(
    address ? `${API_URL}/api/users/${address}/escrows?${query}` : null,
    fetcher,
  );

  const escrows = data?.data ?? data?.items ?? [];
  return { escrows, isLoading, error: error ?? null };
}

/**
 * Fetch paginated list of all escrows (for Explorer).
 *
 * @param {{ page: number, limit: number, status: string }} options
 */
export function useEscrowList({ page = 1, limit = 20, status = '' } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status) params.set('status', status);

  const { data, error, isLoading } = useSWR(`${API_URL}/api/escrows?${params}`, fetcher);

  const escrows = data?.data ?? [];
  const total = data?.pagination?.total ?? data?.total ?? escrows.length;

  return { escrows, total, isLoading, error: error ?? null };
}