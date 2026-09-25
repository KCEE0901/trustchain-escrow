export default function Skeleton({ className = '', variant, ...props }) {
  const variantClasses = {
    heading: 'h-6 rounded-md',
    text: 'h-4 rounded',
    image: 'h-24 rounded-lg',
    circle: 'rounded-full',
  }[variant] || '';

  return (
    <div
      className={`animate-pulse bg-gray-200 dark:bg-gray-700 ${variantClasses} ${className}`}
      {...props}
    />
  );
}

export { Skeleton };

export function EscrowCardSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24 rounded" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="h-3 w-40 rounded" />
      <div className="flex items-center justify-between pt-1">
        <Skeleton className="h-4 w-20 rounded" />
        <Skeleton className="h-4 w-16 rounded" />
      </div>
    </div>
  );
}

export function EscrowListSkeleton({ count = 5 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <EscrowCardSkeleton key={i} />
      ))}
    </div>
  );
}
