/**
 * MilestoneItem Component
 *
 * Renders a single milestone row with its status, amount,
 * and contextual action buttons based on the viewer's role.
 *
 * Action matrix:
 *  ┌──────────────┬─────────────────────────────────────────────┐
 *  │ Status       │ Client can         │ Freelancer can         │
 *  ├──────────────┼────────────────────┼────────────────────────┤
 *  │ Pending      │ —                  │ Submit Work            │
 *  │ Submitted    │ Approve / Reject   │ —                      │
 *  │ Approved     │ — (funds released) │ —                      │
 *  │ Rejected     │ —                  │ Submit Work (retry)    │
 *  └──────────────┴────────────────────┴────────────────────────┘
 *
 * @param {object}   props
 * @param {object}   props.milestone
 * @param {number}   props.index           — for display numbering
 * @param {'client'|'freelancer'|'observer'} props.role
 * @param {Function} props.onApprove(id)
 * @param {Function} props.onReject(id)
 * @param {Function} props.onSubmit(id)
 * @param {boolean}  props.isLast
 *
 * TODO (contributor — medium, Issue #40):
 * - Add confirmation modal before approve/reject
 * - Show tx hash link (Stellar Expert) after approval
 * - Add "View deliverable" link (IPFS hash)
 * - Handle loading state while tx is pending
 */

'use client';

import { useState } from 'react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import CurrencyAmount from '../ui/CurrencyAmount';
import { useI18n } from '../../i18n/index.jsx';
import { useToast } from '../../contexts/ToastContext';

export default function MilestoneItem({
  milestone,
  index,
  role,
  onApprove,
  onReject,
  onSubmit,
  isLast,
}) {
  const [isActing, setIsActing] = useState(false);
  const { t, formatDate } = useI18n();
  const { showToast } = useToast();

  const handleAction = async (actionFn, actionName) => {
    setIsActing(true);
    try {
      await actionFn(milestone.id);
      showToast(`${actionName} milestone successful!`, 'success');
    } catch (err) {
      showToast(`Failed to ${actionName.toLowerCase()} milestone`, 'error');
      console.error(`${actionName} failed:`, err.message);
    } finally {
      setIsActing(false);
    }
  };

  // Determine which status icon to show in the timeline dot
  const dotColor =
    milestone.status === 'Approved' || milestone.status === 'Released'
      ? 'bg-emerald-500'
      : milestone.status === 'Submitted'
        ? 'bg-blue-500'
        : milestone.status === 'Rejected' || milestone.status === 'Disputed'
          ? 'bg-red-500'
          : 'bg-gray-700';

  return (
    <div className="relative flex gap-4">
      {/* Timeline dot + connector */}
      <div className="flex flex-col items-center">
        <div
          className={`w-3 h-3 rounded-full flex-shrink-0 mt-1.5 ring-2 ring-gray-900 ${dotColor}`}
        />
        {!isLast && <div className="w-px flex-1 bg-gray-800 mt-1 min-h-[24px]" />}
      </div>

      {/* Content */}
      <div className="flex-1 pb-4">
        <div className="card space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600 font-mono">
                  #{String(index + 1).padStart(2, '0')}
                </span>
                <h4 className="text-white font-medium">{milestone.title}</h4>
              </div>
              {milestone.submittedAt && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {t('milestone.status.submitted')}: {formatDate(milestone.submittedAt)}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <CurrencyAmount amount={milestone.amount} size="sm" />
              <Badge status={milestone.status} size="sm" />
            </div>
          </div>

          {/* Description */}
          {milestone.description && (
            <p className="text-sm text-gray-400">{milestone.description}</p>
          )}

          {/* Dispute evidence upload section */}
          {milestone.status === 'Disputed' && (
            <div
              className="mt-3 p-3.5 rounded-lg bg-red-950/20 border border-red-900/40 space-y-3"
              data-testid="dispute-evidence-section"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-red-400 uppercase tracking-wide flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  Dispute Evidence
                </span>
                <span className="text-xs text-gray-400">
                  {milestone.evidence?.length || 0} file(s) attached
                </span>
              </div>
              {milestone.evidence && milestone.evidence.length > 0 && (
                <div className="space-y-1.5">
                  {milestone.evidence.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-xs text-gray-300 bg-gray-900/60 px-3 py-2 rounded border border-gray-800"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-gray-500">📄</span>
                        <span className="truncate">{item.name || item.title || item}</span>
                      </div>
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-400 hover:text-indigo-300 ml-2 flex-shrink-0 font-medium"
                        >
                          View
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="pt-1 flex flex-wrap items-center gap-3">
                <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700 hover:border-gray-600 transition-colors">
                  <span>📎 Upload Evidence</span>
                  <input type="file" className="hidden" onChange={() => {}} />
                </label>
                <span className="text-xs text-gray-500">PDF, PNG, JPG up to 10MB</span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          {!isActing ? (
            <ActionButtons
              status={milestone.status}
              role={role}
              onApprove={() => handleAction(onApprove, 'approve')}
              onReject={() => handleAction(onReject, 'reject')}
              onSubmit={() => handleAction(onSubmit, 'submit')}
              t={t}
            />
          ) : (
            <p className="text-xs text-indigo-400 animate-pulse">{t('common.loading')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the correct set of action buttons based on role + status.
 */
function ActionButtons({ status, role, onApprove, onReject, onSubmit, t }) {
  if (role === 'client' && status === 'Submitted') {
    return (
      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={onApprove}>
          ✓ {t('escrow.actions.approve')}
        </Button>
        <Button variant="danger" size="sm" onClick={onReject}>
          ✗ {t('escrow.actions.reject')}
        </Button>
      </div>
    );
  }

  if (role === 'freelancer' && (status === 'Pending' || status === 'Rejected')) {
    return (
      <Button variant="secondary" size="sm" onClick={onSubmit}>
        📤 {t('escrow.actions.submit')}
      </Button>
    );
  }

  if (status === 'Approved' || status === 'Released') {
    return <p className="text-xs text-emerald-400">✓ {t('escrow.actions.approve')}</p>;
  }

  return null;
}
