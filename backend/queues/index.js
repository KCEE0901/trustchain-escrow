import { Queue } from 'bullmq';

class InMemoryQueue {
  constructor(name) {
    this.name = name;
    this.jobs = [];
  }

  async add(eventType, data) {
    const job = {
      id: `${this.name}-${this.jobs.length + 1}`,
      name: eventType,
      data,
    };
    this.jobs.push(job);
    return job;
  }

  async getWaiting() {
    return [...this.jobs];
  }

  async getActive() {
    return [];
  }

  async getFailed() {
    return [];
  }

  async getJobCounts() {
    return { waiting: this.jobs.length, active: 0, delayed: 0, failed: 0 };
  }

  __resetForTests() {
    this.jobs = [];
  }
}

export const connection = process.env.REDIS_URL
  ? { url: process.env.REDIS_URL }
  : {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    };

const createQueue = (name) =>
  process.env.NODE_ENV === 'test' ? new InMemoryQueue(name) : new Queue(name, { connection });

export const emailQueue = createQueue('email');
export const webhookQueue = createQueue('webhook');
export const scheduledQueue = createQueue('scheduled');

// eventQueue is handled separately due to its complex retry/DLQ setup.
// Import it directly from './eventQueue.js' to avoid starting BullMQ workers
// as a side effect of importing shared queue primitives.
//
// This handle points at the same Redis-backed 'blockchain-events' queue but
// carries no worker or job options; it exists only so queue depth can be read
// (e.g. by the Prometheus metrics endpoint) without importing eventQueue.js.
export const eventQueueMonitor = createQueue('blockchain-events');

/** Queue instances keyed by the `queue` label used in Prometheus metrics. */
export const queues = {
  webhooks: webhookQueue,
  email: emailQueue,
  eventQueue: eventQueueMonitor,
  scheduled: scheduledQueue,
};
