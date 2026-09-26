import { createRequire } from 'module';

if (typeof global.require === 'undefined') {
  global.require = createRequire(import.meta.url);
}

if (typeof global.File === 'undefined') {
  global.File = class File extends Blob {
    constructor(bits, name, options = {}) {
      super(bits, options);
      this.name = name;
      this.lastModified = options.lastModified ?? Date.now();
      this.type = options.type ?? '';
    }
  };
}

// ── Mock Cleanup ───────────────────────────────────────────────────────────────
// Prisma mock call counts and resolved values can bleed between tests when mocks
// are not reset after each case.  `jest.clearAllMocks()` resets all spy/mock
// call history, instances, and results without removing the implementation,
// keeping tests isolated without needing to re-import modules on every run.
afterEach(() => {
  jest.clearAllMocks();
});
