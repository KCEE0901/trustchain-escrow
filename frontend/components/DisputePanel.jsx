import EmptyState from './EmptyState';

export default function DisputePanel({ disputes = [], title = 'Disputes' }) {
  if (disputes.length === 0) {
    return (
      <div className="card">
        <h2 className="text-lg font-semibold text-white mb-4">{title}</h2>
        <EmptyState
          title="No disputes yet"
          description="When a dispute is raised, it will appear here for review."
        />
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="text-lg font-semibold text-white mb-4">{title}</h2>
      <div className="flex flex-col gap-3">
        {disputes.map((d) => (
          <div key={d.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white font-semibold">Dispute #{d.id}</span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  d.resolvedAt
                    ? 'bg-emerald-900/30 text-emerald-300'
                    : 'bg-yellow-900/30 text-yellow-300'
                }`}
              >
                {d.resolvedAt ? 'Resolved' : 'Open'}
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Escrow: <span className="font-mono text-gray-400">{d.escrowId?.toString()}</span>
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Raised: {d.raisedAt ? new Date(d.raisedAt).toLocaleDateString() : '—'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
