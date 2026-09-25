'use client';

/**
 * EscrowStatusBadge
 *
 * Displays the real-time status of an escrow, subscribing to live WebSocket
 * updates via useEscrowUpdates. Automatically reconnects on disconnect.
 *
 * Closes #26 — real-time escrow status updates via WebSocket
 *
 * @param {object}  props
 * @param {string|number} props.escrowId   — escrow ID to subscribe to
 * @param {string}  [props.initialStatus] — status to show before first WS event
 * @param {string}  [props.authToken]     — optional WS auth token
 * @param {string}  [props.address]       — viewer's Stellar public key
 * @param {string}  [props.className]
 */

import { useEscrowUpdates } from '../../hooks/useEscrowUpdates';
import { useI18n } from '../../i18n/index.jsx';

const STATUS_STYLES = {
  pending:    'bg-yellow-900/40 text-yellow-300 border-yellow-700',
  active:     'bg-blue-900/40  text-blue-300   border-blue-700',
  funded:     'bg-indigo-900/40 text-indigo-300 border-indigo-700',
  in_dispute: 'bg-red-900/40   text-red-300    border-red-700',
  disputed:   'bg-red-900/40   text-red-300    border-red-700',
  resolved:   'bg-emerald-900/40 text-emerald-300 border-emerald-700',
  completed:  'bg-green-900/40 text-green-300  border-green-700',
  cancelled:  'bg-gray-800/60  text-gray-400   border-gray-600',
  expired:    'bg-orange-900/40 text-orange-300 border-orange-700',
};

const STATUS_TRANSLATION_KEYS = {
  pending:    'escrow.status.pending',
  active:     'escrow.status.active',
  funded:     'escrow.status.funded',
  in_dispute: 'escrow.status.disputed',
  disputed:   'escrow.status.disputed',
  resolved:   'escrow.status.resolved',
  completed:  'escrow.status.completed',
  cancelled:  'escrow.status.cancelled',
  expired:    'escrow.status.expired',
};

const STATUS_FALLBACKS = {
  pending:    'Pending',
  active:     'Active',
  funded:     'Funded',
  in_dispute: 'In Dispute',
  disputed:   'Disputed',
  resolved:   'Resolved',
  completed:  'Completed',
  cancelled:  'Cancelled',
  expired:    'Expired',
};

const WS_STATUS_DOT = {
  idle:         'bg-gray-500',
  connecting:   'bg-yellow-400 animate-pulse',
  connected:    'bg-emerald-400',
  reconnecting: 'bg-orange-400 animate-pulse',
  disconnected: 'bg-red-500',
};

export default function EscrowStatusBadge({
  escrowId,
  initialStatus = 'pending',
  authToken,
  address,
  className = '',
}) {
  const { t, isRTL } = useI18n();
  const { status: wsStatus, lastPayload } = useEscrowUpdates(escrowId, {
    authToken,
    address,
    enabled: Boolean(escrowId),
  });

  const rawStatus = String(lastPayload?.status ?? initialStatus).toLowerCase();
  const styleKey = rawStatus in STATUS_STYLES ? rawStatus : 'pending';
  const translationKey = STATUS_TRANSLATION_KEYS[styleKey] || `escrow.status.${styleKey}`;
  const translated = t(translationKey);
  const label =
    translated && translated !== translationKey
      ? translated
      : (STATUS_FALLBACKS[styleKey] ?? rawStatus);

  return (
    <span
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`
        inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium
        border ${STATUS_STYLES[styleKey]} ${className}
      `}
      aria-label={`Escrow status: ${label}`}
      role="status"
    >
      {/* WebSocket connection indicator */}
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${WS_STATUS_DOT[wsStatus]}`}
        aria-hidden="true"
        title={`WebSocket: ${wsStatus}`}
      />
      <span>{label}</span>
    </span>
  );
}
