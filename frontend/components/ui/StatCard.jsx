/**
 * StatCard Component
 *
 * Small card displaying a single metric with label, value, and optional icon.
 */

function parseTrend(trend) {
  if (trend === undefined || trend === null || trend === '') return null;
  if (typeof trend === 'number') {
    if (trend > 0) return { direction: 'up', label: `${Math.abs(trend)}%` };
    if (trend < 0) return { direction: 'down', label: `${Math.abs(trend)}%` };
    return { direction: 'flat', label: '0%' };
  }
  const text = String(trend).trim();
  const signed = text.startsWith('+') || text.startsWith('-');
  const numeric = Number.parseFloat(text.replace('%', '').replace('+', ''));
  if (!Number.isFinite(numeric)) return null;
  if (numeric > 0 || (signed && text.startsWith('+'))) {
    return { direction: 'up', label: `${Math.abs(numeric)}%` };
  }
  if (numeric < 0 || text.startsWith('-')) {
    return { direction: 'down', label: `${Math.abs(numeric)}%` };
  }
  return { direction: 'flat', label: '0%' };
}

const TREND_META = {
  up: { arrow: '↑', className: 'text-emerald-300' },
  down: { arrow: '↓', className: 'text-rose-300' },
  flat: { arrow: '→', className: 'text-gray-400' },
};

export default function StatCard({ label, value, icon, trend }) {
  const parsedTrend = parseTrend(trend);

  return (
    <div className="card flex flex-col gap-2 w-full sm:w-auto">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
        {icon && <span className="text-lg">{icon}</span>}
      </div>
      <p className="text-2xl font-bold text-white break-all">{value}</p>
      {parsedTrend && (
        <p className={`text-sm flex items-center gap-1 ${TREND_META[parsedTrend.direction].className}`}>
          <span aria-hidden="true">{TREND_META[parsedTrend.direction].arrow}</span>
          <span>{parsedTrend.label}</span>
        </p>
      )}
    </div>
  );
}
