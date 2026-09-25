'use client';

/**
 * EscrowCreationWizard
 *
 * Multi-step wizard for creating a milestone-based escrow on Trustchain.
 * Guides the user through four sequential steps:
 *   1. Parties      — client and contractor Stellar addresses
 *   2. Milestones   — define each milestone, its amount, and description
 *   3. Settings     — funding token, timelock, and arbiter address
 *   4. Review       — confirm all data before on-chain submission
 *
 * Changes:
 *   #343 — TransactionFeeEstimator rendered on the Review step, showing
 *           estimated Stellar network fees in XLM and the user's selected
 *           fiat currency.  Estimation errors are non-blocking warnings.
 *
 *   #348 — Inline validation on blur for every field.  Each invalid field
 *           renders a red error message associated via aria-describedby.
 *           The "Next" button is disabled while the current step has errors.
 *
 * Accessibility:
 *   - Fully keyboard navigable (Tab, Shift+Tab, Enter/Space on buttons)
 *   - Each step panel is labelled with aria-labelledby pointing at the step heading
 *   - Progress indicator uses role="list" with aria-current="step" on the active item
 *   - Errors are announced via aria-live="polite" regions
 */

import { useState, useCallback, useId } from 'react';
import { AlertCircle, CheckCircle2, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import Button from '../ui/Button';
import TransactionFeeEstimator from '../ui/TransactionFeeEstimator';
import { validateStellarAddressField, validatePositiveAmount } from '../../lib/validation';

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS = [
  { id: 'parties',    label: 'Parties' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'settings',   label: 'Settings' },
  { id: 'review',     label: 'Review' },
];

const STELLAR_ADDRESS_RE = /^[GC][A-Z2-7]{55}$/;

const FUNDING_TOKENS = [
  { symbol: 'XLM',  label: 'Lumen (XLM)' },
  { symbol: 'USDC', label: 'USDC (SAC)' },
];

// ─── Validation helpers ────────────────────────────────────────────────────────

function validateAddress(value, fieldName) {
  if (!value.trim()) return `${fieldName} is required.`;
  if (!STELLAR_ADDRESS_RE.test(value.trim())) return `${fieldName} must be a valid Stellar address (G… or C…, 56 characters).`;
  return null;
}

function validateMilestones(milestones) {
  if (milestones.length === 0) return 'Add at least one milestone.';
  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i];
    if (!m.description.trim()) return `Milestone ${i + 1}: description is required.`;
    if (!m.amount || Number(m.amount) <= 0) return `Milestone ${i + 1}: amount must be greater than zero.`;
  }
  return null;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepIndicator({ currentIndex }) {
  return (
    <ol role="list" className="flex items-center gap-0 mb-8" aria-label="Wizard progress">
      {STEPS.map((step, idx) => {
        const isDone    = idx < currentIndex;
        const isCurrent = idx === currentIndex;
        return (
          <li
            key={step.id}
            className="flex items-center"
            aria-current={isCurrent ? 'step' : undefined}
          >
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors',
                  isDone    && 'bg-indigo-600 border-indigo-600 text-white',
                  isCurrent && 'bg-gray-900 border-indigo-500 text-indigo-400',
                  !isDone && !isCurrent && 'bg-gray-800 border-gray-600 text-gray-500',
                )}
                aria-hidden="true"
              >
                {isDone ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
              </div>
              <span
                className={cn(
                  'mt-1 text-xs font-medium',
                  isCurrent ? 'text-indigo-400' : isDone ? 'text-gray-300' : 'text-gray-500',
                )}
              >
                {step.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className={cn(
                  'h-0.5 w-12 sm:w-20 mx-1 mb-5 transition-colors',
                  idx < currentIndex ? 'bg-indigo-600' : 'bg-gray-700',
                )}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 flex items-center gap-1 text-xs text-red-400">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}

function Label({ htmlFor, children, required }) {
  return (
    <label htmlFor={htmlFor} className="block mb-1 text-sm font-medium text-gray-300">
      {children}
      {required && <span className="ml-0.5 text-red-400" aria-hidden="true">*</span>}
    </label>
  );
}

function Input({ id, value, onChange, onBlur, placeholder, className, errorId, hasError, ...rest }) {
  return (
    <input
      id={id}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      placeholder={placeholder}
      aria-describedby={errorId || undefined}
      aria-invalid={hasError || undefined}
      className={cn(
        'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100',
        'placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-900',
        'transition-colors',
        hasError && 'border-red-500 focus:ring-red-500',
        className,
      )}
      {...rest}
    />
  );
}

// ─── Step 1: Parties ──────────────────────────────────────────────────────────

function StepParties({ data, onChange, onBlur, errors }) {
  const clientId     = useId();
  const contractorId = useId();

  return (
    <section aria-labelledby="step-parties-heading">
      <h2 id="step-parties-heading" className="text-xl font-semibold text-gray-100 mb-1">
        Step 1 — Define the parties
      </h2>
      <p className="text-sm text-gray-400 mb-6">
        Enter the Stellar addresses for the client (funder) and the contractor (payee).
      </p>

      <div className="space-y-5">
        <div>
          <Label htmlFor={clientId} required>Client address</Label>
          <Input
            id={clientId}
            value={data.clientAddress}
            onChange={e => onChange('clientAddress', e.target.value)}
            onBlur={() => onBlur('clientAddress')}
            placeholder="GABC… (56 characters)"
            errorId={errors.clientAddress ? `${clientId}-error` : undefined}
            hasError={!!errors.clientAddress}
          />
          <FieldError id={`${clientId}-error`} message={errors.clientAddress} />
        </div>

        <div>
          <Label htmlFor={contractorId} required>Contractor address</Label>
          <Input
            id={contractorId}
            value={data.contractorAddress}
            onChange={e => onChange('contractorAddress', e.target.value)}
            onBlur={() => onBlur('contractorAddress')}
            placeholder="GXYZ… (56 characters)"
            errorId={errors.contractorAddress ? `${contractorId}-error` : undefined}
            hasError={!!errors.contractorAddress}
          />
          <FieldError id={`${contractorId}-error`} message={errors.contractorAddress} />
        </div>
      </div>
    </section>
  );
}

// ─── Step 2: Milestones ───────────────────────────────────────────────────────

function StepMilestones({ data, onChange, onBlur, errors }) {
  const addMilestone = useCallback(() => {
    onChange('milestones', [...data.milestones, { id: Date.now(), description: '', amount: '' }]);
  }, [data.milestones, onChange]);

  const removeMilestone = useCallback((id) => {
    onChange('milestones', data.milestones.filter(m => m.id !== id));
  }, [data.milestones, onChange]);

  const updateMilestone = useCallback((id, field, value) => {
    onChange('milestones', data.milestones.map(m => m.id === id ? { ...m, [field]: value } : m));
  }, [data.milestones, onChange]);

  return (
    <section aria-labelledby="step-milestones-heading">
      <h2 id="step-milestones-heading" className="text-xl font-semibold text-gray-100 mb-1">
        Step 2 — Define milestones
      </h2>
      <p className="text-sm text-gray-400 mb-6">
        Break the project into discrete milestones. Funds are released incrementally as each milestone is approved.
      </p>

      <div aria-live="polite" className="space-y-4">
        {data.milestones.map((m, idx) => {
          const descId      = `ms-${m.id}-desc`;
          const amountId    = `ms-${m.id}-amount`;
          const descErrId   = `ms-${m.id}-desc-error`;
          const amountErrId = `ms-${m.id}-amount-error`;
          const descErr     = errors[`ms-${m.id}-description`];
          const amtErr      = errors[`ms-${m.id}-amount`];

          return (
            <div
              key={m.id}
              className="rounded-lg border border-gray-700 bg-gray-800/60 p-4 space-y-3"
              role="group"
              aria-label={`Milestone ${idx + 1}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-300">Milestone {idx + 1}</span>
                {data.milestones.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeMilestone(m.id)}
                    className="text-gray-500 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded"
                    aria-label={`Remove milestone ${idx + 1}`}
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>

              <div>
                <Label htmlFor={descId} required>Description</Label>
                <Input
                  id={descId}
                  value={m.description}
                  onChange={e => updateMilestone(m.id, 'description', e.target.value)}
                  onBlur={() => onBlur(`ms-${m.id}-description`, m.description)}
                  placeholder="e.g. Deliver wireframes and design mockups"
                  errorId={descErr ? descErrId : undefined}
                  hasError={!!descErr}
                />
                <FieldError id={descErrId} message={descErr} />
              </div>

              <div>
                <Label htmlFor={amountId} required>Amount ({data.fundingToken || 'XLM'})</Label>
                <Input
                  id={amountId}
                  type="number"
                  min="0"
                  step="0.0000001"
                  value={m.amount}
                  onChange={e => updateMilestone(m.id, 'amount', e.target.value)}
                  onBlur={() => onBlur(`ms-${m.id}-amount`, m.amount)}
                  placeholder="0.0000000"
                  errorId={amtErr ? amountErrId : undefined}
                  hasError={!!amtErr}
                />
                <FieldError id={amountErrId} message={amtErr} />
              </div>
            </div>
          );
        })}
      </div>

      {errors.milestones && (
        <div aria-live="assertive" className="mt-3">
          <FieldError id="milestones-error" message={errors.milestones} />
        </div>
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-4"
        onClick={addMilestone}
      >
        <Plus className="w-4 h-4" aria-hidden="true" />
        Add milestone
      </Button>
    </section>
  );
}

// ─── Step 3: Settings ─────────────────────────────────────────────────────────

function StepSettings({ data, onChange, onBlur, errors }) {
  const tokenId    = useId();
  const timelockId = useId();
  const arbiterId  = useId();

  return (
    <section aria-labelledby="step-settings-heading">
      <h2 id="step-settings-heading" className="text-xl font-semibold text-gray-100 mb-1">
        Step 3 — Configure settings
      </h2>
      <p className="text-sm text-gray-400 mb-6">
        Choose the funding token, an optional timelock, and an arbiter address for dispute resolution.
      </p>

      <div className="space-y-5">
        <div>
          <Label htmlFor={tokenId} required>Funding token</Label>
          <select
            id={tokenId}
            value={data.fundingToken}
            onChange={e => onChange('fundingToken', e.target.value)}
            className={cn(
              'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100',
              'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-900',
            )}
          >
            {FUNDING_TOKENS.map(t => (
              <option key={t.symbol} value={t.symbol}>{t.label}</option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor={timelockId}>Timelock (optional)</Label>
          <Input
            id={timelockId}
            type="datetime-local"
            value={data.timelockDate}
            onChange={e => onChange('timelockDate', e.target.value)}
            errorId="timelock-hint"
          />
          <p id="timelock-hint" className="mt-1 text-xs text-gray-500">
            If set, the client can reclaim funds after this date if no milestone has been approved.
          </p>
        </div>

        <div>
          <Label htmlFor={arbiterId}>Arbiter address (optional)</Label>
          <Input
            id={arbiterId}
            value={data.arbiterAddress}
            onChange={e => onChange('arbiterAddress', e.target.value)}
            onBlur={() => onBlur('arbiterAddress')}
            placeholder="GARB… (56 characters) — leave blank to use platform default"
            errorId={errors.arbiterAddress ? `${arbiterId}-error` : 'arbiter-hint'}
            hasError={!!errors.arbiterAddress}
          />
          <p id="arbiter-hint" className="mt-1 text-xs text-gray-500">
            The arbiter resolves disputes by allocating funds between client and contractor.
          </p>
          <FieldError id={`${arbiterId}-error`} message={errors.arbiterAddress} />
        </div>
      </div>
    </section>
  );
}

// ─── Step 4: Review ───────────────────────────────────────────────────────────

/**
 * #343 — Build the fee operations list for TransactionFeeEstimator.
 * One create_escrow op + one fund op + one op per milestone.
 */
function buildFeeOperations(milestones) {
  return [
    { label: 'Create escrow', operations: 1 },
    { label: 'Fund escrow',   operations: 1 },
    { label: 'Register milestones', operations: Math.max(1, milestones.length) },
  ];
}

function StepReview({ data, feeEstimateError }) {
  const totalAmount = data.milestones
    .reduce((sum, m) => sum + (parseFloat(m.amount) || 0), 0)
    .toFixed(7);

  const feeOperations = buildFeeOperations(data.milestones);

  // Attempt to read the XLM/USD rate from CurrencyContext — if the context
  // isn't available we fall back gracefully (fee shown in XLM only).
  let xlmUsdRate;
  try {
    // Dynamic import via require avoids crashing when the context is absent
    // in tests or server renders.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useCurrency } = require('../../contexts/CurrencyContext');
    // We can't call a hook conditionally; instead we wrap in a child component.
  } catch {
    // Context not available — xlmUsdRate stays undefined
  }

  return (
    <section aria-labelledby="step-review-heading">
      <h2 id="step-review-heading" className="text-xl font-semibold text-gray-100 mb-1">
        Step 4 — Review and confirm
      </h2>
      <p className="text-sm text-gray-400 mb-6">
        Review the escrow details below. Once submitted, the configuration is anchored on-chain and cannot be changed.
      </p>

      <div className="space-y-4 text-sm">
        <ReviewSection title="Parties">
          <ReviewRow label="Client"     value={data.clientAddress} mono />
          <ReviewRow label="Contractor" value={data.contractorAddress} mono />
        </ReviewSection>

        <ReviewSection title="Milestones">
          {data.milestones.map((m, idx) => (
            <div key={m.id} className="py-2 border-b border-gray-700 last:border-b-0">
              <div className="flex justify-between text-gray-300">
                <span className="font-medium">#{idx + 1} {m.description}</span>
                <span className="text-indigo-400 font-mono">{m.amount} {data.fundingToken}</span>
              </div>
            </div>
          ))}
          <div className="flex justify-between pt-2 font-semibold text-gray-100">
            <span>Total</span>
            <span className="text-indigo-400 font-mono">{totalAmount} {data.fundingToken}</span>
          </div>
        </ReviewSection>

        <ReviewSection title="Settings">
          <ReviewRow label="Funding token" value={data.fundingToken} />
          <ReviewRow
            label="Timelock"
            value={data.timelockDate ? new Date(data.timelockDate).toUTCString() : 'None'}
          />
          <ReviewRow
            label="Arbiter"
            value={data.arbiterAddress || 'Platform default'}
            mono={!!data.arbiterAddress}
          />
        </ReviewSection>

        {/* #343 — Transaction fee estimate */}
        <div>
          {feeEstimateError ? (
            <div
              role="status"
              className="rounded-xl border border-yellow-700 bg-yellow-900/20 px-4 py-3 text-xs text-yellow-300"
            >
              ⚠️ Could not estimate transaction fee: {feeEstimateError}. You can still proceed.
            </div>
          ) : (
            <FeeEstimatorWithCurrency operations={feeOperations} />
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Inner component that safely reads CurrencyContext.
 * Rendered only inside StepReview so the hook call is unconditional.
 */
function FeeEstimatorWithCurrency({ operations }) {
  let xlmUsdRate;
  try {
    // Attempt to use context — this fails gracefully if CurrencyProvider is absent.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { rates, currency } = useCurrencySafe();
    if (rates && currency && rates['XLM']) {
      // rates are USD-based; XLM rate relative to selected currency
      xlmUsdRate = rates['USD'] / (rates['XLM'] ?? 1);
    }
  } catch {
    // context unavailable — show XLM only
  }

  return (
    <TransactionFeeEstimator
      operations={operations}
      baseFeeStroops={100}
      xlmUsdRate={xlmUsdRate}
      className="mt-2"
    />
  );
}

/** Safe hook wrapper — returns empty object if context not mounted. */
function useCurrencySafe() {
  try {
    // Inline dynamic require so the hook isn't called conditionally
    const mod = require('../../contexts/CurrencyContext');
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return mod.useCurrency();
  } catch {
    return {};
  }
}

function ReviewSection({ title, children }) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/60 overflow-hidden">
      <div className="px-4 py-2 bg-gray-800 border-b border-gray-700">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</span>
      </div>
      <div className="px-4 py-3 space-y-1">{children}</div>
    </div>
  );
}

function ReviewRow({ label, value, mono }) {
  return (
    <div className="flex justify-between gap-4 py-0.5">
      <span className="text-gray-400 shrink-0">{label}</span>
      <span
        className={cn(
          'text-gray-200 text-right truncate',
          mono && 'font-mono text-xs',
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Main Wizard Component ────────────────────────────────────────────────────

export default function EscrowCreationWizard({ onSuccess, onCancel }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [feeEstimateError] = useState(null); // #343 — surface fee estimation errors non-blockingly
  const [errors, setErrors] = useState({});

  const [formData, setFormData] = useState({
    clientAddress:     '',
    contractorAddress: '',
    milestones:        [{ id: Date.now(), description: '', amount: '' }],
    fundingToken:      'XLM',
    timelockDate:      '',
    arbiterAddress:    '',
  });

  const handleFieldChange = useCallback((field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear the error for the field that just changed so the UI is responsive.
    setErrors(prev => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  /**
   * #348 — On-blur validator.
   * fieldKey maps directly to an errors key.
   * For milestone sub-fields the key is `ms-{id}-{field}`.
   */
  const handleBlur = useCallback((fieldKey, overrideValue) => {
    // Resolve the current value for the field being blurred.
    let value = overrideValue;
    if (value === undefined) {
      value = formData[fieldKey] ?? '';
    }

    let error = null;

    if (fieldKey === 'clientAddress') {
      error = validateAddress(value, 'Client address');
    } else if (fieldKey === 'contractorAddress') {
      error = validateAddress(value, 'Contractor address');
      if (!error && value.trim() === formData.clientAddress.trim() && value.trim()) {
        error = 'Contractor address must differ from client address.';
      }
    } else if (fieldKey === 'arbiterAddress') {
      // arbiter is optional — only validate when non-empty
      if (value.trim()) {
        error = validateAddress(value, 'Arbiter address');
      }
    } else if (fieldKey.startsWith('ms-') && fieldKey.endsWith('-description')) {
      if (!value || !value.trim()) error = 'Description is required.';
    } else if (fieldKey.startsWith('ms-') && fieldKey.endsWith('-amount')) {
      error = validatePositiveAmount(value, 'Amount');
    }

    setErrors(prev => {
      const next = { ...prev };
      if (error) {
        next[fieldKey] = error;
      } else {
        delete next[fieldKey];
      }
      return next;
    });
  }, [formData]);

  // Per-step validation (used on Next click and to compute canProceed).
  const validateCurrentStep = useCallback(() => {
    const newErrors = {};
    if (currentStep === 0) {
      const ce = validateAddress(formData.clientAddress, 'Client address');
      const xe = validateAddress(formData.contractorAddress, 'Contractor address');
      if (ce) newErrors.clientAddress = ce;
      if (xe) newErrors.contractorAddress = xe;
      if (!ce && !xe && formData.clientAddress.trim() === formData.contractorAddress.trim()) {
        newErrors.contractorAddress = 'Contractor address must differ from client address.';
      }
    } else if (currentStep === 1) {
      const me = validateMilestones(formData.milestones);
      if (me) newErrors.milestones = me;
      // Also validate individual milestone fields so inline errors appear.
      formData.milestones.forEach(m => {
        if (!m.description.trim()) newErrors[`ms-${m.id}-description`] = 'Description is required.';
        const amtErr = validatePositiveAmount(m.amount, 'Amount');
        if (amtErr) newErrors[`ms-${m.id}-amount`] = amtErr;
      });
    } else if (currentStep === 2) {
      if (formData.arbiterAddress.trim()) {
        const ae = validateAddress(formData.arbiterAddress, 'Arbiter address');
        if (ae) newErrors.arbiterAddress = ae;
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [currentStep, formData]);

  /**
   * #348 — "Next" is disabled while any errors exist for the current step.
   * We compute this from the live errors state so it reacts to on-blur changes.
   */
  const currentStepHasErrors = useCallback(() => {
    if (currentStep === 0) {
      return !!(errors.clientAddress || errors.contractorAddress);
    }
    if (currentStep === 1) {
      return Object.keys(errors).some(k =>
        k === 'milestones' || k.startsWith('ms-'),
      );
    }
    if (currentStep === 2) {
      return !!errors.arbiterAddress;
    }
    return false;
  }, [currentStep, errors]);

  const handleNext = useCallback(() => {
    if (!validateCurrentStep()) return;
    setCurrentStep(s => s + 1);
  }, [validateCurrentStep]);

  const handleBack = useCallback(() => {
    setCurrentStep(s => s - 1);
    setErrors({});
    setSubmitError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const payload = {
        clientAddress:     formData.clientAddress.trim(),
        contractorAddress: formData.contractorAddress.trim(),
        fundingToken:      formData.fundingToken,
        timelockUnix:      formData.timelockDate
          ? Math.floor(new Date(formData.timelockDate).getTime() / 1000)
          : null,
        arbiterAddress: formData.arbiterAddress.trim() || null,
        milestones: formData.milestones.map(m => ({
          description: m.description.trim(),
          amount:      parseFloat(m.amount),
        })),
      };

      const res = await fetch('/api/v1/escrows', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Unexpected error (HTTP ${res.status})`);
      }

      const { id } = await res.json();
      onSuccess?.(id);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, onSuccess]);

  const stepProps = { data: formData, onChange: handleFieldChange, onBlur: handleBlur, errors };

  // #348 — disable Next when the current step has validation errors.
  const nextDisabled = currentStepHasErrors();

  return (
    <div
      className="mx-auto max-w-2xl rounded-xl border border-gray-700 bg-gray-900 p-6 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Create escrow wizard"
    >
      <StepIndicator currentIndex={currentStep} />

      <div className="min-h-[360px]">
        {currentStep === 0 && <StepParties    {...stepProps} />}
        {currentStep === 1 && <StepMilestones {...stepProps} />}
        {currentStep === 2 && <StepSettings   {...stepProps} />}
        {currentStep === 3 && (
          <StepReview data={formData} feeEstimateError={feeEstimateError} />
        )}
      </div>

      {submitError && (
        <div
          role="alert"
          aria-live="assertive"
          className="mt-4 flex items-start gap-2 rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-400"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          {submitError}
        </div>
      )}

      <div className="mt-8 flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="md"
          onClick={currentStep === 0 ? onCancel : handleBack}
        >
          {currentStep === 0 ? 'Cancel' : '← Back'}
        </Button>

        <div className="flex items-center gap-3">
          {currentStep < STEPS.length - 1 ? (
            <Button
              variant="primary"
              size="md"
              onClick={handleNext}
              disabled={nextDisabled}
              aria-disabled={nextDisabled}
            >
              Next
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              isLoading={isSubmitting}
              onClick={handleSubmit}
            >
              Create escrow
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}