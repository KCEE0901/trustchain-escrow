'use client';

/**
 * Admin — Queue Management Page
 *
 * Hosts the DeadLetterQueue component that gives administrators visibility
 * into failed BullMQ jobs and lets them replay or acknowledge them.
 *
 * Implements #233 — Queue Dead-Letter Admin UI
 */

import Link from 'next/link';
import DeadLetterQueue from '../../../components/admin/DeadLetterQueue';

export default function AdminQueuesPage() {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Queue Management</h1>
          <p className="mt-1 text-sm text-gray-400">
            Monitor and manage background job queues.
          </p>
        </div>
        <Link
          href="/admin"
          className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          ← Dashboard
        </Link>
      </div>

      <DeadLetterQueue />
    </div>
  );
}
