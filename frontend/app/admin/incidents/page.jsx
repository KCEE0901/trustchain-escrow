'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAdminStore } from '../../../store/app-store';
import { adminFetch } from '../../../store/admin';

const SEVERITIES = ['', 'SEV1', 'SEV2', 'SEV3', 'SEV4'];
const STATUSES = ['', 'open', 'acknowledged', 'investigating', 'mitigated', 'resolved', 'post_mortem', 'closed'];

function getInitialFilters() {
  if (typeof window === 'undefined') return { q: '', severity: '', status: '' };
  const params = new URLSearchParams(window.location.search);
  return {
    q: params.get('q') || '',
    severity: params.get('severity') || '',
    status: params.get('status') || '',
  };
}

function persistFilters(filters) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.status) params.set('status', filters.status);
  const query = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}

export default function AdminIncidentsPage() {
  const { apiKey } = useAdminStore();
  const [filters, setFilters] = useState(getInitialFilters);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadIncidents = useCallback(async () => {
    if (!apiKey) return;

    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      if (filters.severity) params.set('severity', filters.severity);
      if (filters.status) params.set('status', filters.status);

      const query = params.toString();
      const response = await adminFetch(`/api/incidents${query ? `?${query}` : ''}`, apiKey);

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load incidents');
      }

      const body = await response.json();
      setIncidents(Array.isArray(body) ? body : body.data || []);
    } catch (err) {
      setError(err.message || 'Failed to load incidents');
      setIncidents([]);
    } finally {
      setLoading(false);
    }
  }, [apiKey, filters.severity, filters.status]);

  useEffect(() => {
    persistFilters(filters);
  }, [filters]);

  useEffect(() => {
    loadIncidents();
  }, [loadIncidents]);

  const visibleIncidents = useMemo(() => {
    const query = filters.q.trim().toLowerCase();
    if (!query) return incidents;

    return incidents.filter((incident) =>
      [incident.id, incident.title, incident.description, incident.commander]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [filters.q, incidents]);

  if (!apiKey) {
    return (
      <div className="card">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Incident Triage</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Authenticate from the admin dashboard before viewing incidents.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Incident Triage</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Filter incidents by severity, status, and search text.
        </p>
      </div>

      <section aria-label="Incident filters" className="grid gap-3 md:grid-cols-3">
        <label className="text-sm text-gray-700 dark:text-gray-300">
          Search
          <input
            aria-label="Search incidents"
            value={filters.q}
            onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
            className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
            placeholder="ID, title, description, commander"
          />
        </label>

        <label className="text-sm text-gray-700 dark:text-gray-300">
          Severity
          <select
            aria-label="Severity"
            value={filters.severity}
            onChange={(event) => setFilters((prev) => ({ ...prev, severity: event.target.value }))}
            className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
          >
            {SEVERITIES.map((value) => (
              <option key={value || 'all'} value={value}>
                {value || 'All severities'}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm text-gray-700 dark:text-gray-300">
          Status
          <select
            aria-label="Status"
            value={filters.status}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
            className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
          >
            {STATUSES.map((value) => (
              <option key={value || 'all'} value={value}>
                {value ? value.replaceAll('_', ' ') : 'All statuses'}
              </option>
            ))}
          </select>
        </label>
      </section>

      {error && <p role="alert">{error}</p>}

      {loading ? (
        <p role="status">Loading incidents…</p>
      ) : visibleIncidents.length === 0 ? (
        <div className="card" role="status">
          No incidents match the current filters.
        </div>
      ) : (
        <table className="w-full text-left text-sm" aria-label="Incidents">
          <thead>
            <tr>
              <th>Incident</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Commander</th>
            </tr>
          </thead>
          <tbody>
            {visibleIncidents.map((incident) => (
              <tr key={incident.id}>
                <td>
                  <div>{incident.title}</div>
                  <div>{incident.id}</div>
                </td>
                <td>{incident.severity}</td>
                <td>{incident.status}</td>
                <td>{incident.commander || 'Unassigned'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
