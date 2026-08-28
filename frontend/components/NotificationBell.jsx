'use client';

/**
 * Render a notification bell button.
 *
 * @param {{ isLoading?: boolean }} props
 * @returns {JSX.Element}
 */
export default function NotificationBell({ isLoading = false }) {
  if (isLoading) {
    return (
      <div role="status" aria-label="Loading notifications">
        Loading notifications
      </div>
    );
  }

  return (
    <button type="button" aria-label="Open notifications">
      Notifications
    </button>
  );
}
