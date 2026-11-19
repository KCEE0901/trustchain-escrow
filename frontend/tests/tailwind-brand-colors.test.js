import config from '../tailwind.config.js';

describe('tailwind brand colors (#665)', () => {
  const colors = config.theme.extend.colors;

  it('exports accent, success, warning, and danger mapped to CSS variables', () => {
    expect(colors.accent).toBe('var(--color-accent)');
    expect(colors.success).toBe('var(--color-success)');
    expect(colors.warning).toBe('var(--color-warning)');
    expect(colors.danger).toBe('var(--color-danger)');
  });

  it('keeps the default indigo palette available (brand extend does not replace it)', () => {
    // Tailwind defaults are not overridden; brand.indigo would be wrong.
    expect(colors.indigo).toBeUndefined();
    expect(colors.brand[600]).toBe('#4f46e5');
  });
});
