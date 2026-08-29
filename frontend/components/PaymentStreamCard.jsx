/**
 * PaymentStreamCard Component
 *
 * Renders a card listing the active payment streams tied to an escrow.
 * When the data source returns zero streams, shows a friendly, actionable
 * empty state instead of rendering nothing.
 *
 * @param {object}   props
 * @param {Array}    [props.streams=[]]   — array of payment stream objects
 * @param {Function} [props.onCreateStream] — opens the "create stream" flow
 */

import EmptyState from './ui/EmptyState';

function formatAmount(stream) {
  if (stream.amount == null) return '—';
  return `${stream.amount} ${stream.asset ?? 'XLM'}`;
}

export default function PaymentStreamCard({ streams = [], onCreateStream }) {
  if (streams.length === 0) {
    return (
      <div className="card" data-testid="payment-stream-card">
        <EmptyState
          title="No payment streams yet"
          description="Once you start streaming payments for this escrow, they'll show up here so you can track releases in real time."
          actionLabel={onCreateStream ? 'Start a payment stream' : undefined}
          onAction={onCreateStream}
        />
      </div>
    );
  }

  return (
    <div className="card" data-testid="payment-stream-card">
      <h3 className="text-lg font-semibold text-white mb-4">Payment Streams</h3>
      <ul className="divide-y divide-gray-800">
        {streams.map((stream) => (
          <li key={stream.id} className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium text-white">{stream.label ?? stream.id}</p>
              <p className="text-xs text-gray-400">{stream.status ?? 'active'}</p>
            </div>
            <span className="text-sm text-gray-300">{formatAmount(stream)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
