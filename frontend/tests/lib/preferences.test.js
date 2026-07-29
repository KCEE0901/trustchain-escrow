import { getDefaultPreferences, readPreferences, writePreferences } from '../../lib/preferences';

describe('preferences persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns defaults when no preferences are stored', () => {
    expect(readPreferences()).toEqual(getDefaultPreferences());
  });

  it('persists user preferences across reads', () => {
    writePreferences({ theme: 'dark', currency: 'EUR', reducedMotion: true });

    expect(readPreferences()).toMatchObject({
      theme: 'dark',
      currency: 'EUR',
      reducedMotion: true,
    });
  });
});
