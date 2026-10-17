const fs = require('fs');
const path = require('path');

const CSS_PATH = path.resolve(__dirname, '..', 'app', 'globals.css');

function readCss() {
  return fs.readFileSync(CSS_PATH, 'utf8');
}

/**
 * Extracts the body of a CSS at-rule block (e.g. @media (...) { ... })
 * by matching braces so nested rules are handled correctly.
 */
function extractBlock(css, headerPattern) {
  const match = headerPattern.exec(css);
  if (!match) {
    return null;
  }
  const startIndex = match.index + match[0].length;
  let depth = 1;
  let i = startIndex;
  while (i < css.length && depth > 0) {
    const char = css[i];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
    }
    i += 1;
  }
  if (depth !== 0) {
    return null;
  }
  return css.slice(startIndex, i - 1);
}

describe('globals.css reduced-motion contract (#541)', () => {
  let css;

  beforeAll(() => {
    css = readCss();
  });

  it('exists as a readable stylesheet', () => {
    expect(typeof css).toBe('string');
    expect(css.length).toBeGreaterThan(0);
  });

  it('defines a prefers-reduced-motion: reduce media block', () => {
    const header = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/;
    expect(header.test(css)).toBe(true);
  });

  it('disables transform-based animations inside the reduced-motion block', () => {
    const block = extractBlock(
      css,
      /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/
    );
    expect(block).not.toBeNull();

    // Near-zero animation duration for the primary success path.
    expect(block).toMatch(/animation-duration\s*:\s*(0(\.0+)?m?s|0\.0*1m?s)/i);

    // Transform-based motion must be neutralized.
    expect(block).toMatch(/transform\s*:\s*none/i);

    // Transitions should also be effectively disabled.
    expect(block).toMatch(/transition-duration\s*:\s*(0(\.0+)?m?s|0\.0*1m?s)/i);
  });

  it('preserves opacity and color feedback under reduced motion', () => {
    const block = extractBlock(
      css,
      /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/
    );
    expect(block).not.toBeNull();

    // Opacity feedback must remain available (not forced to 0 or none).
    expect(block).toMatch(/opacity\s*:\s*(?!0\b)[0-9.]+/i);

    // Color-based feedback must remain available.
    expect(block).toMatch(/(background-color|color|border-color)\s*:/i);
  });
});

describe('globals.css action-state gating contract (#540)', () => {
  let css;

  beforeAll(() => {
    css = readCss();
  });

  it('defines [data-action-state] selectors for gating', () => {
    expect(css).toMatch(/\[data-action-state\]/);
  });

  it('covers the disabled action state', () => {
    expect(css).toMatch(/\[data-action-state\s*=\s*["']?disabled["']?\]/);
  });

  it('covers the hidden action state', () => {
    expect(css).toMatch(/\[data-action-state\s*=\s*["']?hidden["']?\]/);
  });

  it('covers the enabled action state', () => {
    expect(css).toMatch(/\[data-action-state\s*=\s*["']?enabled["']?\]/);
  });

  it('applies non-interactive affordances to disabled actions', () => {
    const disabledRule = /\[data-action-state\s*=\s*["']?disabled["']?\]\s*\{[^}]*\}/;
    const match = disabledRule.exec(css);
    expect(match).not.toBeNull();
    expect(match[0]).toMatch(/pointer-events\s*:\s*none/i);
    expect(match[0]).toMatch(/cursor\s*:\s*not-allowed/i);
  });

  it('hides actions marked hidden', () => {
    const hiddenRule = /\[data-action-state\s*=\s*["']?hidden["']?\]\s*\{[^}]*\}/;
    const match = hiddenRule.exec(css);
    expect(match).not.toBeNull();
    expect(match[0]).toMatch(/display\s*:\s*none/i);
  });
});