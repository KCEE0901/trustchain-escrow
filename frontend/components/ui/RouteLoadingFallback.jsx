export default function RouteLoadingFallback({ label = 'Loading page…' }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
      <div className="card flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
        <span
          className="h-4 w-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin"
          aria-hidden="true"
        />
        <span>{label}</span>
      </div>
    </div>
  );
}
