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

/**
 * Resolve the bell label shown to assistive technology.
 *
 * @param {{ unreadCount?: number }} props
 * @returns {string}
 */
export function getNotificationBellLabel({ unreadCount = 0 } = {}) {
  return unreadCount > 0 ? `Open notifications (${unreadCount} unread)` : 'Open notifications';
}
