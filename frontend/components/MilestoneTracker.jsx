'use client';

import { useMemo } from 'react';
import MilestoneList from './escrow/MilestoneList';

export default function MilestoneTracker({ milestones = [], role, onApprove, onReject, onSubmit }) {
  const stats = useMemo(() => {
    const total = milestones.length;
    const approved = milestones.filter((m) => m.status === 'Approved').length;
    const submitted = milestones.filter((m) => m.status === 'Submitted').length;
    const pending = milestones.filter((m) => m.status === 'Pending').length;
    const progress = total === 0 ? 0 : Math.round((approved / total) * 100);

    return { total, approved, submitted, pending, progress };
  }, [milestones]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-center">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Total</p>
          <p className="text-xl font-bold text-white">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-center">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Approved</p>
          <p className="text-xl font-bold text-emerald-400">{stats.approved}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-center">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Submitted</p>
          <p className="text-xl font-bold text-yellow-400">{stats.submitted}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-center">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Pending</p>
          <p className="text-xl font-bold text-gray-400">{stats.pending}</p>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-gray-400 font-medium">Overall progress</span>
          <span className="text-white font-bold">{stats.progress}%</span>
        </div>
        <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${stats.progress}%` }}
          />
        </div>
      </div>

      <MilestoneList
        milestones={milestones}
        role={role}
        onApprove={onApprove}
        onReject={onReject}
        onSubmit={onSubmit}
      />
    </div>
  );
}
