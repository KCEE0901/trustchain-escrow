export class BoundedRetentionStore {
  constructor(limit = 1000) {
    if (!Number.isInteger(limit) || limit < 1) throw new TypeError('retention limit must be a positive integer');
    this.limit = limit;
    this.entries = new Map();
  }

  set(key, value) {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value);
  }

  get(key) { return this.entries.get(key); }
}

export function createSingleFlight() {
  const pending = new Map();
  return async (key, work) => {
    if (pending.has(key)) return pending.get(key);
    const promise = Promise.resolve().then(work).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  };
}

export async function gracefullyDegrade(work, fallback) {
  try { return await work(); } catch { return typeof fallback === 'function' ? fallback() : fallback; }
}
