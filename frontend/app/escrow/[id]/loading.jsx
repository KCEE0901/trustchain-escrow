import Skeleton from '../../../components/ui/Skeleton';
import EscrowCardSkeleton from '../../../components/ui/EscrowCardSkeleton';

export default function EscrowDetailLoading() {
  return (
    <div
      className="space-y-8 max-w-4xl mx-auto"
      role="status"
      aria-busy="true"
      aria-label="Loading escrow details"
      data-testid="escrow-detail-skeleton"
    >
      {/* Header Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="space-y-2 flex-1">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-64 rounded-md" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <Skeleton className="h-4 w-28 rounded" />
          <Skeleton className="h-4 w-40 rounded" />
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-28 rounded-lg" />
        </div>
      </div>

      {/* Refresh Bar Skeleton */}
      <div className="flex items-center justify-between text-sm">
        <Skeleton className="h-4 w-36 rounded" />
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>

      {/* Info Grid (Total, Remaining, Created, Deadline) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card py-3 space-y-2">
            <Skeleton className="h-3 w-16 rounded" />
            <Skeleton className="h-6 w-24 rounded" />
          </div>
        ))}
      </div>

      {/* Transaction Hash */}
      <div className="card space-y-2">
        <Skeleton className="h-3 w-28 rounded" />
        <Skeleton className="h-5 w-full max-w-md rounded" />
      </div>

      {/* Parties (Client & Freelancer) */}
      <div className="card grid grid-cols-1 md:grid-cols-2 gap-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-16 rounded" />
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-4 w-36 rounded" />
                <Skeleton className="h-3 w-20 rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Milestones Section */}
      <section className="space-y-4">
        <Skeleton className="h-6 w-32 rounded" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-4 space-y-3">
              <div className="flex justify-between items-center">
                <Skeleton className="h-5 w-48 rounded" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
              <Skeleton className="h-4 w-32 rounded" />
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
      </section>

      {/* Transaction History Section */}
      <div className="card space-y-4">
        <Skeleton className="h-5 w-40 rounded" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex justify-between items-center py-2 border-b border-gray-800 last:border-b-0"
            >
              <div className="space-y-1">
                <Skeleton className="h-4 w-32 rounded" />
                <Skeleton className="h-3 w-24 rounded" />
              </div>
              <Skeleton className="h-4 w-20 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
