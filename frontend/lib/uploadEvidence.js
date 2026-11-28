const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(['text/plain', 'application/pdf', 'image/png', 'image/jpeg']);

/**
 * Upload dispute reason bytes via the existing dispute evidence endpoint.
 * @returns {Promise<string>} IPFS CID / content hash returned by the API
 */
export async function uploadDisputeReason(escrowId, reasonText) {
  const trimmed = reasonText.trim();
  if (!trimmed) {
    throw new Error('Please describe the dispute before submitting.');
  }
  const blob = new Blob([trimmed], { type: 'text/plain' });
  if (blob.size > MAX_BYTES) {
    throw new Error('Reason text exceeds the maximum upload size.');
  }
  if (!ACCEPTED_TYPES.has('text/plain')) {
    throw new Error('Unsupported content type for reason upload.');
  }

  const body = new FormData();
  body.append('file', blob, 'dispute-reason.txt');

  const res = await fetch(`${API_URL}/api/disputes/${escrowId}/evidence`, {
    method: 'POST',
    body,
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload?.message || payload?.error || `Upload failed (${res.status})`);
  }

  const data = await res.json();
  const hash = data?.ipfsCid || data?.cid || data?.hash;
  if (!hash) {
    throw new Error('Upload succeeded but no content hash was returned.');
  }
  return hash;
}