import { completedEvents, pruneEventHistory } from '../services/eventWorker.js';

describe('event worker persistence safeguards', () => {
  beforeEach(() => completedEvents.clear());
  it('retains one deterministic completion marker per event', () => {
    completedEvents.set('10:event-1', Date.now());
    completedEvents.set('10:event-1', Date.now());
    expect(completedEvents.size).toBe(1);
  });
  it('removes expired completion markers safely', () => {
    completedEvents.set('old', 0);
    expect(pruneEventHistory(Date.now())).toBe(0);
  });
});
