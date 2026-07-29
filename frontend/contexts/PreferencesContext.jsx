'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getDefaultPreferences, readPreferences, writePreferences } from '../lib/preferences';

const PreferencesContext = createContext(null);

export function PreferencesProvider({ children }) {
  const [preferences, setPreferencesState] = useState(getDefaultPreferences);

  useEffect(() => {
    const stored = readPreferences();
    const reducedMotion =
      stored.reducedMotion ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      false;

    setPreferencesState({ ...stored, reducedMotion });
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', Boolean(preferences.reducedMotion));
  }, [preferences.reducedMotion]);

  const setPreferences = useCallback((nextPreferences) => {
    setPreferencesState((current) => {
      const next =
        typeof nextPreferences === 'function' ? nextPreferences(current) : nextPreferences;
      const merged = { ...current, ...next };
      writePreferences(merged);
      return merged;
    });
  }, []);

  const value = useMemo(() => ({ preferences, setPreferences }), [preferences, setPreferences]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('usePreferences must be used within PreferencesProvider');
  return context;
}
