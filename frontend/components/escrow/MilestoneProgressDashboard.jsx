/**
 * Milestone Progress Dashboard Component
 *
 * Comprehensive dashboard for clients and freelancers to track milestone progress
 * in an escrow agreement. Displays milestone status, progress percentage, timeline,
 * and key metrics for both parties.
 *
 * Features:
 * - Real-time milestone status tracking (Pending, Submitted, Approved, Released, Disputed)
 * - Progress percentage calculation from completed vs total milestones
 * - Status breakdown statistics (pending, submitted, approved, released, disputed)
 * - Milestone timeline with status badges
 * - Role-appropriate views (client vs freelancer)
 * - Auto-refresh on on-chain state changes
 *
 * @param {object}   props
 * @param {object}   props.escrow            — escrow metadata and status
 * @param {Array}    props.milestones        — array of Milestone objects
 * @param {'client'|'freelancer'|'observer'} props.role
 * @param {boolean}  props.loading           — whether data is being fetched
 * @param {Function} props.onRefresh         — callback to refresh milestone data
 *
 */

import React, { useMemo, useEffect, useState } from 'react';

const MILESTONE_STATUS_COLORS = {
  Pending: 'bg-gray-600',
  Submitted: 'bg-blue-600',
  Approved: 'bg-green-600',
  Released: 'bg-emerald-600',
  Rejected: 'bg-red-600',
  Disputed: 'bg-orange-600',
};

const MILESTONE_STATUS_LABELS = {
  Pending: 'Awaiting submission',
  Submitted: 'Work submitted',
  Approved: 'Approved',
  Released: 'Funds released',
  Rejected: 'Rejected',
  Disputed: 'Under dispute',
};

export default function MilestoneProgressDashboard({
  escrow = {},
  milestones = [],
  role = 'observer',
  loading = false,
  onRefresh = () => {},
}) {
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);

  // Compute milestone statistics
  const statistics = useMemo(() => {
    const stats = {
      total: milestones.length,
      pending: 0,
      submitted: 0,
      approved: 0,
      released: 0,
      rejected: 0,
      disputed: 0,
    };

    milestones.forEach((m) => {
      const status = m.status || 'Pending';
      if (status === 'Pending') stats.pending += 1;
      else if (status === 'Submitted') stats.submitted += 1;
      else if (status === 'Approved') stats.approved += 1;
      else if (status === 'Released') stats.released += 1;
      else if (status === 'Rejected') stats.rejected += 1;
      else if (status === 'Disputed') stats.disputed += 1;
    });

    // Calculate progress percentage (approved + released / total)
    const completedCount = stats.approved + stats.released;
    const progressPercent = stats.total > 0 ? Math.round((completedCount / stats.total) * 100) : 0;

    return { ...stats, completedCount, progressPercent };
  }, [milestones]);

  // Auto-refresh data when milestone states change
  useEffect(() => {
    if (!autoRefreshEnabled) return;

    const refreshInterval = setInterval(() => {
      onRefresh();
    }, 30000); // Refresh every 30 seconds

    return () => clearInterval(refreshInterval);
  }, [autoRefreshEnabled, onRefresh]);

  if (milestones.length === 0) {
    return (
      <div className="card bg-gradient-to-br from-gray-900 to-gray-800 p-8 text-center">
        <div className="text-gray-400">
          <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-lg mb-1 font-medium">No milestones defined</p>
          <p className="text-sm">
            {role === 'client'
              ? 'Define milestones to structure the project deliverables.'
              : 'Awaiting milestone definitions from the client.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Milestone Progress</h2>
        <button
          onClick={() => onRefresh()}
          disabled={loading}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg text-white transition-colors text-sm font-medium"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Progress Summary Card */}
      <div className="card bg-gradient-to-br from-indigo-900 to-purple-900 p-6 rounded-xl border border-purple-700">
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div>
            <p className="text-gray-300 text-sm font-medium mb-1">Overall Progress</p>
            <p className="text-4xl font-bold text-white">{statistics.progressPercent}%</p>
          </div>
          <div>
            <p className="text-gray-300 text-sm font-medium mb-1">Completed Milestones</p>
            <p className="text-4xl font-bold text-emerald-400">
              {statistics.completedCount}/{statistics.total}
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden shadow-inner">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-full transition-all duration-700 ease-out shadow-lg"
              style={{ width: `${statistics.progressPercent}%` }}
            />
          </div>
          <p className="text-gray-400 text-xs text-right">
            {Math.ceil((statistics.total - statistics.completedCount) * (100 / statistics.total))}% remaining
          </p>
        </div>
      </div>

      {/* Status Breakdown Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { key: 'pending', label: 'Pending', count: statistics.pending },
          { key: 'submitted', label: 'Submitted', count: statistics.submitted },
          { key: 'approved', label: 'Approved', count: statistics.approved },
          { key: 'released', label: 'Released', count: statistics.released },
          { key: 'rejected', label: 'Rejected', count: statistics.rejected },
          { key: 'disputed', label: 'Disputed', count: statistics.disputed },
        ].map((stat) => (
          <div key={stat.key} className="card bg-gray-800 p-4 rounded-lg text-center border border-gray-700">
            <p className="text-gray-400 text-xs font-medium mb-2">{stat.label}</p>
            <p className="text-2xl font-bold text-white">{stat.count}</p>
          </div>
        ))}
      </div>

      {/* Milestone Timeline */}
      <div className="card bg-gray-900 p-6 rounded-xl border border-gray-700">
        <h3 className="text-lg font-semibold text-white mb-6">Milestone Timeline</h3>

        <div className="space-y-4">
          {milestones.map((milestone, index) => {
            const status = milestone.status || 'Pending';
            const statusColor = MILESTONE_STATUS_COLORS[status] || 'bg-gray-600';
            const statusLabel = MILESTONE_STATUS_LABELS[status] || status;

            return (
              <div key={milestone.id || index} className="flex gap-4 items-start">
                {/* Timeline Indicator */}
                <div className="flex flex-col items-center">
                  <div className={`w-4 h-4 ${statusColor} rounded-full shadow-lg`} />
                  {index !== milestones.length - 1 && (
                    <div className="w-0.5 h-12 bg-gradient-to-b from-gray-600 to-gray-800 mt-2" />
                  )}
                </div>

                {/* Milestone Details */}
                <div className="flex-1 pt-0.5 pb-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="font-medium text-white">
                        Milestone {index + 1}
                        {milestone.title && `: ${milestone.title}`}
                      </p>
                      <p className="text-sm text-gray-400">{statusLabel}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-white">
                        {milestone.amount ? `${milestone.amount} XLM` : 'TBD'}
                      </p>
                      <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${statusColor} text-white`}>
                        {status}
                      </span>
                    </div>
                  </div>

                  {milestone.description && (
                    <p className="text-sm text-gray-300 mb-2">{milestone.description}</p>
                  )}

                  {milestone.submitted_at && (
                    <p className="text-xs text-gray-500">
                      Submitted: {new Date(milestone.submitted_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Auto-refresh Toggle */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-800 rounded-lg border border-gray-700">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={autoRefreshEnabled}
            onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
            className="w-4 h-4 rounded"
          />
          <span className="text-sm text-gray-300">Auto-refresh every 30 seconds</span>
        </label>
        <p className="text-xs text-gray-500">Last updated: {new Date().toLocaleTimeString()}</p>
      </div>
    </div>
  );
}
