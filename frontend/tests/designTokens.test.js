const fs = require('fs');
const path = require('path');

const CSS_PATH = path.resolve(__dirname, '..', 'app', 'globals.css');

/**
 * Reads the globals.css file from disk.
 * Throws a deterministic error if the file is missing so failures are obvious.
 */
function readGlobalsCss() {
  if (!fs.existsSync(CSS_PATH)) {
    throw new Error(`globals.css not found at expected path: ${CSS_PATH}`);
  }
  return fs.readFileSync(CSS_PATH, 'utf8');
}

/**
 * Extracts the contents of a top-level `:root { ... }` block.
 * Returns the raw declaration body (without braces).
 */
function extractRootBlock(css) {
  const match = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (!match) {
    throw new Error('Could not find a :root block in globals.css');
  }
  return match[1];
}

/**
 * Parses `--custom-property: value;` declarations into a plain object.
 * Later declarations win, mirroring CSS cascade behavior within a block.
 */
function parseCustomProperties(block) {
  const props = {};
  const declRegex = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let match;
  while ((match = declRegex.exec(block)) !== null) {
    const name = match[1].trim();
    const value = match[2].trim().replace(/\s+/g, ' ');
    props[name] = value;
  }
  return props;
}

/**
 * Extracts all media query blocks and their bodies.
 */
function extractMediaBlocks(css) {
  const blocks = [];
  const mediaRegex = /@media[^{]+\{([\s\S]*?)\n\}/g;
  let match;
  while ((match = mediaRegex.exec(css)) !== null) {
    blocks.push(match[0]);
  }
  return blocks;
}

describe('design tokens in globals.css', () => {
  let css;
  let rootProps;

  beforeAll(() => {
    css = readGlobalsCss();
    rootProps = parseCustomProperties(extractRootBlock(css));
  });

  describe('success path', () => {
    it('defines a :root block with custom properties', () => {
      expect(Object.keys(rootProps).length).toBeGreaterThan(0);
    });

    it('defines core color tokens with deterministic values', () => {
      // Core tokens that must exist and be stable.
      expect(rootProps['--color-background']).toBeDefined();
      expect(rootProps['--color-foreground']).toBeDefined();
      expect(rootProps['--color-primary']).toBeDefined();
      expect(rootProps['--color-secondary']).toBeDefined();
    });

    it('defines spacing and radius tokens', () => {
      expect(rootProps['--spacing-unit']).toBeDefined();
      expect(rootProps['--radius-sm']).toBeDefined();
      expect(rootProps['--radius-md']).toBeDefined();
    });

    it('uses consistent token values without duplicate conflicting definitions', () => {
      // Ensure no token is declared twice with different values inside :root.
      const rootBlock = extractRootBlock(css);
      const declRegex = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
      const seen = {};
      let match;
      while ((match = declRegex.exec(rootBlock)) !== null) {
        const name = match[1].trim();
        const value = match[2].trim().replace(/\s+/g, ' ');
        if (seen[name] !== undefined) {
          expect(seen[name]).toBe(value);
        }
        seen[name] = value;
      }
    });
  });

  describe('boundary and failure paths', () => {
    it('does not leave empty token values', () => {
      Object.entries(rootProps).forEach(([name, value]) => {
        expect(value.length).toBeGreaterThan(0);
        expect(name.startsWith('--')).toBe(true);
      });
    });

    it('declares media-query overrides explicitly rather than relying on implicit inheritance', () => {
      const mediaBlocks = extractMediaBlocks(css);
      // If media queries exist, any custom property overrides inside them
      // must be explicit declarations (name: value;), not empty.
      mediaBlocks.forEach((block) => {
        const overrides = parseCustomProperties(block);
        Object.entries(overrides).forEach(([name, value]) => {
          expect(name.startsWith('--')).toBe(true);
          expect(value.length).toBeGreaterThan(0);
        });
      });
    });

    it('fails deterministically when the CSS file is missing', () => {
      const originalExists = fs.existsSync;
      const originalRead = fs.readFileSync;
      try {
        fs.existsSync = () => false;
        expect(() => readGlobalsCss()).toThrow(/globals\.css not found/);
      } finally {
        fs.existsSync = originalExists;
        fs.readFileSync = originalRead;
      }
    });

    it('fails deterministically when no :root block is present', () => {
      expect(() => extractRootBlock('body { color: red; }')).toThrow(
        /Could not find a :root block/
      );
    });
  });
});