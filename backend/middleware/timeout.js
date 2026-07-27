/**
 * Request Timeout Middleware
 *
 * Enforces a maximum response time for all Express routes and provides
 * configurable per-route timeout overrides.  When a request exceeds
 * the configured deadline the connection is terminated with HTTP 503 and
 * an appropriate JSON error body before the handler completes.
 *
 * Strategy:
 *  - A global default timeout is applied to every request via `timeoutMiddleware`.
 *  - Individual routes can raise or lower the budget with `withTimeout(ms)`.
 *  - Downstream HTTP calls made via axios are given a separate budget
 *    (DEFAULT_DOWNSTREAM_TIMEOUT_MS) so a slow external service cannot
 *    silently consume the full request window.
 *
 * Env vars:
 *  REQUEST_TIMEOUT_MS           Default request timeout in ms (default: 30000).
 *  DOWNSTREAM_TIMEOUT_MS        Axios/fetch call timeout in ms (default: 10000).
 *  TIMEOUT_DISABLE_KEEP_ALIVE   Set to "true" to destroy the socket after timeout.
 */

import { createModuleLogger } from '../config/logger.js';

const log = createModuleLogger('middleware.timeout');

export const DEFAULT_REQUEST_TIMEOUT_MS = parseInt(
  process.env.REQUEST_TIMEOUT_MS || '30000',
  10,
);

export const DEFAULT_DOWNSTREAM_TIMEOUT_MS = parseInt(
  process.env.DOWNSTREAM_TIMEOUT_MS || '10000',
  10,
);

const DISABLE_KEEP_ALIVE = process.env.TIMEOUT_DISABLE_KEEP_ALIVE === 'true';

/**
 * Returns an Express middleware that aborts the request with HTTP 503 if the
 * handler has not responded within `ms` milliseconds.
 *
 * @param {number} [ms=DEFAULT_REQUEST_TIMEOUT_MS] - Timeout budget in ms.
 * @returns {import('express').RequestHandler}
 */
export function withTimeout(ms = DEFAULT_REQUEST_TIMEOUT_MS) {
  return function requestTimeoutMiddleware(req, res, next) {
    if (res.headersSent) return next();

    const timer = setTimeout(() => {
      if (res.headersSent) return;

      log.warn({
        message: 'request_timeout',
        method: req.method,
        path: req.originalUrl?.split('?')[0],
        timeoutMs: ms,
        requestId: req.id,
      });

      if (DISABLE_KEEP_ALIVE) {
        res.setHeader('Connection', 'close');
        req.socket?.destroy();
      }

      res.status(503).json({
        error: 'Request timed out. The server took too long to respond.',
        code: 'REQUEST_TIMEOUT',
        timeoutMs: ms,
      });
    }, ms);

    // Ensure the timer doesn't hold the process open and is cleared on finish.
    timer.unref();

    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));

    next();
  };
}

/**
 * Global request timeout middleware using the default budget.
 * Mount this before route handlers in server.js.
 */
export const timeoutMiddleware = withTimeout(DEFAULT_REQUEST_TIMEOUT_MS);

/**
 * Returns axios request config defaults that apply the downstream timeout.
 *
 * Usage:
 *   const response = await axios.get(url, downstreamAxiosConfig());
 *
 * @param {number} [ms=DEFAULT_DOWNSTREAM_TIMEOUT_MS]
 * @returns {{ timeout: number, signal: AbortSignal }}
 */
export function downstreamAxiosConfig(ms = DEFAULT_DOWNSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref();
  return {
    timeout: ms,
    signal: controller.signal,
  };
}

export default timeoutMiddleware;
