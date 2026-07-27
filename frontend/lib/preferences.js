const PREFERENCES_KEY = 'ste_user_preferences';

const DEFAULT_PREFERENCES = {
  theme: null,
  currency: 'USD',
  reducedMotion: false,
};

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function readPreferences() {
  if (!canUseStorage()) return { ...DEFAULT_PREFERENCES };

  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};

    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
      theme: parsed.theme ?? window.localStorage.getItem('theme') ?? DEFAULT_PREFERENCES.theme,
      currency:
        parsed.currency ?? window.localStorage.getItem('ste_currency') ?? DEFAULT_PREFERENCES.currency,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function writePreferences(nextPreferences) {
  if (!canUseStorage()) return;

  try {
    const current = readPreferences();
    const merged = { ...current, ...nextPreferences };
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(merged));

    if (merged.theme) window.localStorage.setItem('theme', merged.theme);
    if (merged.currency) window.localStorage.setItem('ste_currency', merged.currency);
  } catch {
    // Storage can be unavailable in private browsing or restricted environments.
  }
}
