'use client';

/**
 * TransactionStatusTimeline — Animated transaction status stepper
 *
 * Renders a vertical (mobile) or horizontal (≥ md) progress timeline
 * for an escrow transaction, with CSS-transition animations between
 * steps, full ARIA support, and Tailwind dark-mode classes.
 *
 * Usage:
 *   <TransactionStatusTimeline
 *     steps={[
 *       { id: 'created',   label: 'Created',    description: 'Escrow initialised' },
 *       { id: 'funded',    label: 'Funded',     description: 'XLM deposited' },
 *       { id: 'active',    label: 'Active',     description: 'Work in progress' },
 *       { id: 'completed', label: 'Completed',  description: 'Funds released' },
 *     ]}
 *     currentStep="active"
 *     error={false}
 *   />
 *
 * Issue #25
 */

// ─── Status colours ─────────────────────────────────────────────────
const STEP_STATE = {
  completed: {
    ring: 'ring-emerald-500',
    bg: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    connector: 'bg-emerald-500',
    iconPath:
      'M4.5 12.75l6 6 9-13.5', // check
  },
  current: {
    ring: 'ring-brand-500',
    bg: 'bg-brand-500',
    text: 'text-brand-600 dark:text-brand-400',
    connector: 'bg-gray-200 dark:bg-gray-700',
    iconPath: null,
  },
  error: {
    ring: 'ring-red-500',
    bg: 'bg-red-500',
    text: 'text-red-600 dark:text-red-400',
    connector: 'bg-gray-200 dark:bg-gray-700',
    iconPath:
      'M6 18 18 6M6 6l12 12', // X
  },
  upcoming: {
    ring: 'ring-gray-300 dark:ring-gray-600',
    bg: 'bg-white dark:bg-gray-800',
    text: 'text-gray-400 dark:text-gray-500',
    connector: 'bg-gray-200 dark:bg-gray-700',
    iconPath: null,
  },
};

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
      aria-hidden="true"
      className="h-4 w-4"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
      aria-hidden="true"
      className="h-4 w-4"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

// Pulsing ring for the current active step
function PulseRing() {
  return (
    <span
      className="absolute inset-0 rounded-full animate-ping opacity-30 bg-brand-500"
      aria-hidden="true"
    />
  );
}

// ─── Single step node ───────────────────────────────────────────────
function StepNode({ step, state, stepNumber, isLast, orientation }) {
  const cfg = STEP_STATE[state];
  const isVertical = orientation === 'vertical';

  return (
    <li
      className={`relative flex ${isVertical ? 'flex-row gap-4' : 'flex-col items-center gap-2'} ${
        !isLast && !isVertical ? 'flex-1' : ''
      }`}
      aria-current={state === 'current' ? 'step' : undefined}
    >
      {/* ── Connector line (before the dot on vertical; below on horizontal) ── */}
      {!isLast && (
        <div
          aria-hidden="true"
          className={`
            absolute transition-colors duration-500
            ${
              isVertical
                ? `left-[15px] top-8 w-0.5 bottom-0 ${cfg.connector}`
                : `top-4 left-1/2 w-full h-0.5 ${cfg.connector}`
            }
          `}
        />
      )}

      {/* ── Step dot ───────────────────────────────── */}
      <div className={`relative flex-shrink-0 ${isVertical ? '' : 'z-10'}`}>
        <div
          className={`
            relative h-8 w-8 rounded-full flex items-center justify-center
            ring-2 transition-all duration-500
            ${cfg.ring} ${cfg.bg}
          `}
        >
          {state === 'current' && <PulseRing />}
          {state === 'completed' && (
            <span className="text-white">
              <CheckIcon />
            </span>
          )}
          {state === 'error' && (
            <span className="text-white">
              <XIcon />
            </span>
          )}
          {(state === 'upcoming' || state === 'current') && (
            <span
              className={`text-xs font-bold ${
                state === 'current' ? 'text-white' : 'text-gray-400 dark:text-gray-500'
              }`}
            >
              {stepNumber}
            </span>
          )}
        </div>
      </div>

      {/* ── Label & description ─────────────────────── */}
      <div className={`${isVertical ? 'pb-6 min-w-0' : 'text-center mt-1'}`}>
        <p className={`text-sm font-semibold transition-colors duration-300 ${cfg.text}`}>
          {step.label}
        </p>
        {step.description && (
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
            {step.description}
          </p>
        )}
        {step.timestamp && (
          <time
            dateTime={new Date(step.timestamp).toISOString()}
            className="mt-0.5 block text-[10px] text-gray-400 dark:text-gray-500 tabular-nums"
          >
            {new Date(step.timestamp).toLocaleString()}
          </time>
        )}
      </div>
    </li>
  );
}

// ─── Main component ─────────────────────────────────────────────────
/**
 * @param {{
 *   steps: Array<{
 *     id: string,
 *     label: string,
 *     description?: string,
 *     timestamp?: string | number,
 *   }>,
 *   currentStep: string,
 *   error?: boolean,
 *   orientation?: 'vertical' | 'horizontal',
 *   className?: string,
 * }} props
 */
export default function TransactionStatusTimeline({
  steps = [],
  currentStep,
  error = false,
  orientation,
  className = '',
}) {
  // Auto-switch to vertical on narrow containers via CSS; caller can override
  const resolvedOrientation = orientation ?? 'vertical';

  const currentIndex = steps.findIndex((s) => s.id === currentStep);

  function getState(index) {
    if (error && index === currentIndex) return 'error';
    if (index < currentIndex) return 'completed';
    if (index === currentIndex) return 'current';
    return 'upcoming';
  }

  return (
    <nav
      aria-label="Transaction status timeline"
      className={`w-full ${className}`}
    >
      {/* Horizontal layout hidden on mobile, shown on md+ unless forced vertical */}
      <ol
        className={`
          ${resolvedOrientation === 'horizontal'
            ? 'hidden md:flex items-start gap-0'
            : 'hidden'}
        `}
        role="list"
      >
        {steps.map((step, i) => (
          <StepNode
            key={step.id}
            step={step}
            state={getState(i)}
            stepNumber={i + 1}
            isLast={i === steps.length - 1}
            orientation="horizontal"
          />
        ))}
      </ol>

      {/* Vertical layout — always shown on mobile; hidden on md+ if horizontal */}
      <ol
        className={`
          flex flex-col
          ${resolvedOrientation === 'horizontal' ? 'md:hidden' : ''}
        `}
        role="list"
      >
        {steps.map((step, i) => (
          <StepNode
            key={step.id}
            step={step}
            state={getState(i)}
            stepNumber={i + 1}
            isLast={i === steps.length - 1}
            orientation="vertical"
          />
        ))}
      </ol>
    </nav>
  );
}

// ─── Default escrow step presets ────────────────────────────────────
export const ESCROW_STEPS = [
  { id: 'created',   label: 'Created',    description: 'Escrow contract initialised on Stellar' },
  { id: 'funded',    label: 'Funded',     description: 'XLM deposited into escrow account' },
  { id: 'active',    label: 'Active',     description: 'Work in progress' },
  { id: 'completed', label: 'Completed',  description: 'Funds released to recipient' },
];

export const DISPUTE_STEPS = [
  { id: 'created',   label: 'Created',    description: 'Escrow contract initialised' },
  { id: 'funded',    label: 'Funded',     description: 'XLM deposited' },
  { id: 'disputed',  label: 'Disputed',   description: 'Dispute raised — awaiting arbitration' },
  { id: 'resolved',  label: 'Resolved',   description: 'Arbitrator decision applied' },
];
