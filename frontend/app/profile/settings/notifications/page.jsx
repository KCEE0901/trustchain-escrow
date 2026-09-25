'use client';

import { useState, useCallback, useEffect } from 'react';
import { useWallet } from '../../../../hooks/useWallet';
import { useToast } from '../../../../contexts/ToastContext';

const NOTIFICATION_EVENTS = [
  {
    id: 'milestone_approved',
    label: 'Milestone Approved',
    description: 'When a milestone is approved by the client',
  },
  {
    id: 'dispute_raised',
    label: 'Dispute Raised',
    description: 'When a dispute is opened or updated on your escrow',
  },
  {
    id: 'escrow_completed',
    label: 'Escrow Completed',
    description: 'When all milestones are completed and funds are released',
  },
  {
    id: 'new_message',
    label: 'New Message',
    description: 'When you receive a new message or update in chat',
  },
];

const CHANNELS = [
  { id: 'email', label: 'Email' },
  { id: 'in_app', label: 'In-App' },
];

function createInitialPreferences() {
  const prefs = {};
  for (const event of NOTIFICATION_EVENTS) {
    prefs[event.id] = {};
    for (const channel of CHANNELS) {
      prefs[event.id][channel.id] = true;
    }
  }
  return prefs;
}

function validatePreferences(prefs) {
  const errors = [];
  for (const event of NOTIFICATION_EVENTS) {
    for (const channel of CHANNELS) {
      if (typeof prefs[event.id]?.[channel.id] !== 'boolean') {
        errors.push(`${event.label} ${channel.label} must be a boolean value`);
      }
    }
  }
  return errors;
}

export default function NotificationPreferencesPage() {
  const { address, isConnected } = useWallet();
  const { showToast } = useToast();
  const [preferences, setPreferences] = useState(createInitialPreferences);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Attempt to load existing preferences from server
  useEffect(() => {
    let isMounted = true;
    async function fetchPreferences() {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
        const url = `${baseUrl.replace(/\/api\/?$/, '')}/api/v1/notifications/preferences${
          address ? `?address=${encodeURIComponent(address)}` : ''
        }`;
        const res = await fetch(url).catch(() => null);
        if (res && res.ok) {
          const data = await res.json().catch(() => null);
          if (isMounted && data?.preferences) {
            setPreferences((prev) => ({
              ...prev,
              ...data.preferences,
            }));
          }
        }
      } catch (_) {
        // Fall back to default initial preferences
      }
    }

    fetchPreferences();
    return () => {
      isMounted = false;
    };
  }, [address]);

  const handleToggle = useCallback((eventId, channelId) => {
    setPreferences((prev) => ({
      ...prev,
      [eventId]: {
        ...prev[eventId],
        [channelId]: !prev[eventId]?.[channelId],
      },
    }));
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');

    const validationErrors = validatePreferences(preferences);
    if (validationErrors.length > 0) {
      setError(validationErrors.join('. '));
      return;
    }

    setIsSubmitting(true);

    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
      const endpoint = `${baseUrl.replace(/\/api\/?$/, '')}/api/v1/notifications/preferences`;

      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: address || undefined,
          preferences,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to save preferences (${res.status})`);
      }

      showToast('Notification preferences saved successfully.', 'success');
    } catch (err) {
      setError(err.message || 'An error occurred while saving preferences.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Notification Preferences</h1>
        <p className="text-gray-400 mt-1 text-sm">
          Customize your email and in-app alerts for critical escrow events.
        </p>
      </div>

      {!isConnected && (
        <div
          className="bg-amber-500/10 border border-amber-500/50 text-amber-400 p-4 rounded-xl text-sm"
          role="status"
        >
          Connect your wallet to associate notification preferences with your Stellar account.
        </div>
      )}

      {error && (
        <div
          className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl text-sm"
          role="alert"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" role="grid" aria-label="Notification preferences">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left py-3 px-2 text-gray-400 font-medium" scope="col">
                  Event
                </th>
                {CHANNELS.map((channel) => (
                  <th
                    key={channel.id}
                    className="text-center py-3 px-2 text-gray-400 font-medium"
                    scope="col"
                  >
                    {channel.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_EVENTS.map((event) => (
                <tr
                  key={event.id}
                  className="border-b border-gray-800/50 hover:bg-gray-900/30 transition-colors"
                >
                  <td className="py-4 px-2">
                    <div className="flex flex-col">
                      <span className="text-white font-medium">{event.label}</span>
                      <span className="text-gray-500 text-xs mt-0.5">{event.description}</span>
                    </div>
                  </td>
                  {CHANNELS.map((channel) => {
                    const inputId = `${event.id}_${channel.id}`;
                    const isChecked = preferences[event.id]?.[channel.id] ?? true;
                    return (
                      <td key={channel.id} className="text-center py-4 px-2">
                        <label
                          htmlFor={inputId}
                          className="inline-flex items-center justify-center cursor-pointer"
                          aria-label={`${event.label} — ${channel.label} notification ${isChecked ? 'enabled' : 'disabled'}`}
                        >
                          <input
                            id={inputId}
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggle(event.id, channel.id)}
                            className="sr-only peer"
                            aria-checked={isChecked}
                            role="switch"
                          />
                          <div className="w-10 h-6 bg-gray-700 rounded-full peer-checked:bg-indigo-600 peer-focus:ring-2 peer-focus:ring-indigo-500/50 relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium py-2.5 px-6 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            aria-label="Save notification preferences"
          >
            {isSubmitting ? 'Saving...' : 'Save Preferences'}
          </button>
        </div>
      </form>
    </div>
  );
}
