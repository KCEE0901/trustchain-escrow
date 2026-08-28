/**
 * Shared escrow validation and formatting helpers.
 * Extracted from EscrowTimeline to reduce duplication (#277).
 */

/**
 * Format a timestamp to a human-readable date string.
 */
export function formatTimestamp(timestamp) {
  if (!timestamp) return 'N/A';
  const date = new Date(timestamp * 1000);
  if (isNaN(date.getTime())) return 'Invalid date';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a Stellar amount (stroops to XLM).
 */
export function formatAmount(stroops) {
  if (stroops == null || isNaN(Number(stroops))) return '0.00';
  return (Number(stroops) / 1e7).toFixed(2);
}

/**
 * Validate an escrow status is one of the known values.
 */
export function isValidStatus(status) {
  const VALID_STATUSES = ['pending', 'active', 'completed', 'disputed', 'cancelled', 'expired'];
  return typeof status === 'string' && VALID_STATUSES.includes(status.toLowerCase());
}

/**
 * Get a display label for a status.
 */
export function getStatusLabel(status) {
  if (!isValidStatus(status)) return 'Unknown';
  const labels = {
    pending: 'Pending',
    active: 'Active',
    completed: 'Completed',
    disputed: 'Disputed',
    cancelled: 'Cancelled',
    expired: 'Expired',
  };
  return labels[status.toLowerCase()] || 'Unknown';
}

/**
 * Get a CSS class for a status badge.
 */
export function getStatusColor(status) {
  if (!isValidStatus(status)) return 'bg-gray-100 text-gray-800';
  const colors = {
    pending: 'bg-yellow-100 text-yellow-800',
    active: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    disputed: 'bg-red-100 text-red-800',
    cancelled: 'bg-gray-100 text-gray-800',
    expired: 'bg-orange-100 text-orange-800',
  };
  return colors[status.toLowerCase()] || 'bg-gray-100 text-gray-800';
}

/**
 * Safely check if a value is null or undefined.
 * Standardized null check pattern (#278).
 */
export function isNil(value) {
  return value === null || value === undefined;
}

/**
 * Truncate a Stellar address for display.
 */
export function truncateAddress(address) {
  if (isNil(address) || typeof address !== 'string') return '';
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
