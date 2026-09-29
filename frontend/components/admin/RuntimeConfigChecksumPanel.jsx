'use client';

export default function RuntimeConfigChecksumPanel({ instances = [] }) {
  const rows = instances.length
    ? instances
    : [
        { name: 'api-primary', checksum: 'pending', generatedAt: 'Not reported' },
        { name: 'worker-primary', checksum: 'pending', generatedAt: 'Not reported' },
      ];

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
        Runtime Checksums
      </h2>
      <div className="space-y-2">
        {rows.map((instance) => (
          <div
            key={instance.name}
            className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-900/50 px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium text-white">{instance.name}</p>
              <p className="text-xs text-gray-500">{instance.generatedAt}</p>
            </div>
            <code className="rounded bg-gray-950 px-2 py-1 text-xs text-indigo-300">
              {instance.checksum}
            </code>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Checksums compare safe runtime configuration only; secrets and provider credentials are
        excluded.
      </p>
    </div>
  );
}
