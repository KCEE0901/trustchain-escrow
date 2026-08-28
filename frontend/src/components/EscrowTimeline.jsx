import React from 'react';
import {
  formatTimestamp,
  getStatusLabel,
  getStatusColor,
  formatAmount,
  isValidStatus,
  isNil,
} from '../utils/escrowHelpers';

/**
 * Renders a timeline of escrow milestones and status transitions.
 * Uses shared helpers from escrowHelpers.js (#277).
 */
export default function EscrowTimeline({ escrow, milestones = [] }) {
  if (isNil(escrow)) {
    return <div className="text-gray-500 text-sm">No escrow data available.</div>;
  }

  const events = buildTimelineEvents(escrow, milestones);

  return (
    <div className="escrow-timeline" role="list" aria-label="Escrow timeline">
      {events.map((event, index) => (
        <TimelineEvent key={event.id || index} event={event} isLast={index === events.length - 1} />
      ))}
    </div>
  );
}

function TimelineEvent({ event, isLast }) {
  return (
    <div className="flex gap-4" role="listitem">
      <div className="flex flex-col items-center">
        <div className={`w-3 h-3 rounded-full ${getStatusColor(event.status)}`} />
        {!isLast && <div className="w-0.5 h-full bg-gray-200 my-1" />}
      </div>
      <div className="pb-6">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusColor(event.status)}`}>
            {getStatusLabel(event.status)}
          </span>
          <span className="text-xs text-gray-500">{formatTimestamp(event.timestamp)}</span>
        </div>
        <p className="text-sm text-gray-700 mt-1">{event.description}</p>
        {!isNil(event.amount) && (
          <p className="text-xs text-gray-500 mt-0.5">{formatAmount(event.amount)} XLM</p>
        )}
      </div>
    </div>
  );
}

/**
 * Build a sorted list of timeline events from escrow data and milestones.
 * Uses shared validation/formatting helpers instead of inline logic.
 */
function buildTimelineEvents(escrow, milestones) {
  const events = [];

  if (!isNil(escrow.createdAt)) {
    events.push({
      id: 'created',
      status: 'pending',
      timestamp: escrow.createdAt,
      description: `Escrow created for ${formatAmount(escrow.amount)} XLM`,
      amount: escrow.amount,
    });
  }

  if (isValidStatus(escrow.status) && escrow.status !== 'pending') {
    events.push({
      id: 'status-change',
      status: escrow.status,
      timestamp: escrow.updatedAt || escrow.createdAt,
      description: `Escrow ${getStatusLabel(escrow.status).toLowerCase()}`,
    });
  }

  milestones.forEach((milestone, i) => {
    if (!isNil(milestone.completedAt)) {
      events.push({
        id: `milestone-${i}`,
        status: 'completed',
        timestamp: milestone.completedAt,
        description: milestone.title || `Milestone ${i + 1} completed`,
        amount: milestone.amount,
      });
    }
  });

  return events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}
