import { describe, expect, it } from '@jest/globals';
import express from 'express';
import request from 'supertest';

import { withTimeout, timeoutLabels } from '../../middleware/timeout.js';
import { httpRequestTimeoutsTotal } from '../../lib/metrics.js';

async function timeoutCount(labels) {
  const { values } = await httpRequestTimeoutsTotal.get();
  const match = values.find(
    (v) => v.labels.method === labels.method && v.labels.route === labels.route,
  );
  return match ? match.value : 0;
}

describe('timeout metrics', () => {
  it('increments the timeout counter with route and method labels', async () => {
    const app = express();
    app.get('/api/escrows/:id', withTimeout(20), () => {
      // never responds
    });

    const before = await timeoutCount({ method: 'GET', route: '/api/escrows/:id' });
    const res = await request(app).get('/api/escrows/12345');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('REQUEST_TIMEOUT');
    expect(await timeoutCount({ method: 'GET', route: '/api/escrows/:id' })).toBe(before + 1);
  });

  it('does not increment when the handler responds in time', async () => {
    const app = express();
    app.get('/fast', withTimeout(200), (req, res) => res.json({ ok: true }));

    const before = await timeoutCount({ method: 'GET', route: '/fast' });
    const res = await request(app).get('/fast');

    expect(res.status).toBe(200);
    expect(await timeoutCount({ method: 'GET', route: '/fast' })).toBe(before);
  });

  it('produces safe labels for unknown methods and raw paths', () => {
    const labels = timeoutLabels({
      method: 'PROPFIND',
      path: '/api/users/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7/escrows/42',
    });
    expect(labels).toEqual({ method: 'OTHER', route: '/api/users/:address/escrows/:id' });
  });
});
