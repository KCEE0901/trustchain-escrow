/**
 * EmptyStates — Pre-built empty state illustrations for common contexts.
 *
 * Each component wraps <EmptyState> with a context-specific SVG illustration,
 * default copy, and sensible props. Import the variant you need.
 *
 * Closes #29 — empty state illustrations
 *
 * Exports:
 *   EmptyEscrows, EmptyDisputes, EmptyTransactions,
 *   EmptySearch, EmptyNotifications, EmptyActivity
 */

import EmptyState from './EmptyState';

// ── Shared illustration helpers ───────────────────────────────────────────────

function IllustrationEscrows() {
  return (
    <svg
      aria-hidden="true"
      width="120"
      height="120"
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="mb-6 opacity-40"
    >
      <circle cx="60" cy="60" r="56" stroke="#4F46E5" strokeWidth="2" strokeDasharray="6 4" />
      {/* Vault door */}
      <rect x="30" y="30" width="60" height="60" rx="8" stroke="#4F46E5" strokeWidth="1.5" fill="#1E1B4B" />
      <circle cx="60" cy="60" r="18" stroke="#6366F1" strokeWidth="1.5" />
      <circle cx="60" cy="60" r="10" stroke="#818CF8" strokeWidth="1.5" />
      {/* Dial marks */}
      {[0,45,90,135,180,225,270,315].map((deg, i) => {
        const r = deg * Math.PI / 180;
        const x1 = 60 + 14 * Math.cos(r);
        const y1 = 60 + 14 * Math.sin(r);
        const x2 = 60 + 18 * Math.cos(r);
        const y2 = 60 + 18 * Math.sin(r);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#4F46E5" strokeWidth="1.5" />;
      })}
      {/* Handle */}
      <line x1="60" y1="42" x2="60" y2="52" stroke="#818CF8" strokeWidth="2" strokeLinecap="round" />
      {/* Hinges */}
      <rect x="30" y="38" width="8" height="10" rx="2" fill="#312E81" stroke="#4F46E5" strokeWidth="1" />
      <rect x="30" y="72" width="8" height="10" rx="2" fill="#312E81" stroke="#4F46E5" strokeWidth="1" />
    </svg>
  );
}

function IllustrationDisputes() {
  return (
    <svg
      aria-hidden="true"
      width="120"
      height="120"
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="mb-6 opacity-40"
    >
      <circle cx="60" cy="60" r="56" stroke="#EF4444" strokeWidth="2" strokeDasharray="6 4" />
      {/* Shield */}
      <path d="M60 25 L85 35 L85 62 C85 76 73 87 60 92 C47 87 35 76 35 62 L35 35 Z"
        fill="#1E1B4B" stroke="#EF4444" strokeWidth="1.5" strokeLinejoin="round" />
      {/* Checkmark */}
      <path d="M48 58 L57 67 L74 50" stroke="#818CF8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IllustrationTransactions() {
  return (
    <svg
      aria-hidden="true"
      width="120"
      height="120"
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="mb-6 opacity-40"
    >
      <circle cx="60" cy="60" r="56" stroke="#4F46E5" strokeWidth="2" strokeDasharray="6 4" />
      {/* Arrows */}
      <path d="M35 48 L85 48" stroke="#4F46E5" strokeWidth="2" strokeLinecap="round" />
      <path d="M73 38 L85 48 L73 58" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M85 72 L35 72" stroke="#4F46E5" strokeWidth="2" strokeLinecap="round" />
      <path d="M47 62 L35 72 L47 82" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IllustrationSearch() {
  return (
    <svg
      aria-hidden="true"
      width="120"
      height="120"
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="mb-6 opacity-40"
    >
      <circle cx="60" cy="60" r="56" stroke="#4F46E5" strokeWidth="2" strokeDasharray="6 4" />
      <circle cx="52" cy="52" r="20" stroke="#6366F1" strokeWidth="2" />
      <line x1="66" y1="66" x2="85" y2="85" stroke="#818CF8" strokeWidth="3" strokeLinecap="round" />
      {/* X inside */}
      <line x1="44" y1="44" x2="60" y2="60" stroke="#4F46E5" strokeWidth="2" strokeLinecap="round" />
      <line x1="60" y1="44" x2="44" y2="60" stroke="#4F46E5" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IllustrationNotifications() {
  return (
    <svg
      aria-hidden="true"
      width="120"
      height="120"
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="mb-6 opacity-40"
    >
      <circle cx="60" cy="60" r="56" stroke="#4F46E5" strokeWidth="2" strokeDasharray="6 4" />
      {/* Bell */}
      <path d="M60 28 C49 28 40 37 40 48 L40 68 L34 74 L86 74 L80 68 L80 48 C80 37 71 28 60 28 Z"
        fill="#1E1B4B" stroke="#6366F1" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M53 74 C53 77.3 56.1 80 60 80 C63.9 80 67 77.3 67 74"
        stroke="#818CF8" strokeWidth="1.5" strokeLinecap="round" />
      {/* Z's for quiet */}
      <text x="70" y="42" fill="#4F46E5" fontSize="10" fontFamily="monospace" opacity="0.7">z</text>
      <text x="76" y="34" fill="#4F46E5" fontSize="8"  fontFamily="monospace" opacity="0.5">z</text>
    </svg>
  );
}

function IllustrationActivity() {
  return (
    <svg
      aria-hidden="true"
      width="120"
      height="120"
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="mb-6 opacity-40"
    >
      <circle cx="60" cy="60" r="56" stroke="#4F46E5" strokeWidth="2" strokeDasharray="6 4" />
      {/* Activity line */}
      <polyline
        points="25,70 38,70 46,45 54,75 62,55 70,65 78,50 86,65 95,65"
        stroke="#6366F1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

// ── Exported variants ─────────────────────────────────────────────────────────

export function EmptyEscrows({ actionLabel = 'Create Escrow', actionHref = '/escrow/create', ...rest }) {
  return (
    <EmptyState
      illustration={<IllustrationEscrows />}
      title="No escrows yet"
      description="Your escrow contracts will appear here. Create one to get started."
      actionLabel={actionLabel}
      actionHref={actionHref}
      {...rest}
    />
  );
}

export function EmptyDisputes({ ...rest }) {
  return (
    <EmptyState
      illustration={<IllustrationDisputes />}
      title="No disputes"
      description="All your escrows are dispute-free. That's a good sign!"
      {...rest}
    />
  );
}

export function EmptyTransactions({ ...rest }) {
  return (
    <EmptyState
      illustration={<IllustrationTransactions />}
      title="No transactions"
      description="Once funds are deposited or released, your transaction history will appear here."
      {...rest}
    />
  );
}

export function EmptySearch({ query, ...rest }) {
  return (
    <EmptyState
      illustration={<IllustrationSearch />}
      title={query ? `No results for "${query}"` : 'No results found'}
      description="Try adjusting your filters or search terms."
      {...rest}
    />
  );
}

export function EmptyNotifications({ ...rest }) {
  return (
    <EmptyState
      illustration={<IllustrationNotifications />}
      title="All caught up"
      description="You have no new notifications. We'll let you know when something needs your attention."
      {...rest}
    />
  );
}

export function EmptyActivity({ ...rest }) {
  return (
    <EmptyState
      illustration={<IllustrationActivity />}
      title="No activity yet"
      description="Actions like milestone completions, payments, and status changes will appear here."
      {...rest}
    />
  );
}
