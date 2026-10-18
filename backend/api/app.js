'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const logger = require('./lib/logger');
const requestId = require('./middleware/requestId');
const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');
const routes = require('./routes');

const app = express();

// Bounded metric names for middleware ordering telemetry.
const MIDDLEWARE_METRICS = Object.freeze({
  REQUEST_START: 'api.middleware.request.start',
  REQUEST_END: 'api.middleware.request.end',
  REQUEST_ERROR: 'api.middleware.request.error',
  RATE_LIMITED: 'api.middleware.rate_limited',
  NOT_FOUND: 'api.middleware.not_found',
});

// Emit a bounded, secret-free metric + correlated log line.
function emitTelemetry(metric, level, message, context) {
  const safeContext = {
    requestId: context && context.requestId ? String(context.requestId) : undefined,
    method: context && context.method ? String(context.method) : undefined,
    status: context && Number.isInteger(context.status) ? context.status : undefined,
    durationMs: context && Number.isFinite(context.durationMs) ? context.durationMs : undefined,
  };

  if (typeof logger.metric === 'function') {
    logger.metric(metric, safeContext);
  }

  const logFn = typeof logger[level] === 'function' ? logger[level] : logger.info;
  logFn.call(logger, message, safeContext);
}

// 1. Request correlation id must be first so all downstream logs correlate.
app.use(requestId);

// 2. Security and transport middleware.
app.use(helmet());
app.use(cors());
app.use(compression());

// 3. Body parsing.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 4. Structured access logging (no bodies, no headers with secrets).
app.use(
  morgan(':method :url :status :res[content-length] - :response-time ms', {
    stream: {
      write: (line) => {
        logger.info('api.request.access', { line: line.trim() });
      },
    },
  })
);

// 5. Request lifecycle telemetry (success path).
app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  emitTelemetry(MIDDLEWARE_METRICS.REQUEST_START, 'info', 'api.request.start', {
    requestId: req.id,
    method: req.method,
  });

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    emitTelemetry(MIDDLEWARE_METRICS.REQUEST_END, 'info', 'api.request.end', {
      requestId: req.id,
      method: req.method,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 1000) / 1000,
    });
  });

  res.on('close', () => {
    if (!res.writableEnded) {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      emitTelemetry(MIDDLEWARE_METRICS.REQUEST_ERROR, 'warn', 'api.request.aborted', {
        requestId: req.id,
        method: req.method,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 1000) / 1000,
      });
    }
  });

  next();
});

// 6. Rate limiting (boundary path).
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    emitTelemetry(MIDDLEWARE_METRICS.RATE_LIMITED, 'warn', 'api.request.rate_limited', {
      requestId: req.id,
      method: req.method,
      status: 429,
    });
    res.status(429).json({ error: 'Too many requests' });
  },
});
app.use(limiter);

// 7. Application routes.
app.use('/api', routes);

// 8. Not found (boundary path).
app.use((req, res, next) => {
  emitTelemetry(MIDDLEWARE_METRICS.NOT_FOUND, 'warn', 'api.request.not_found', {
    requestId: req.id,
    method: req.method,
    status: 404,
  });
  next();
});
app.use(notFound);

// 9. Centralized error handling must be last.
app.use((err, req, res, next) => {
  emitTelemetry(MIDDLEWARE_METRICS.REQUEST_ERROR, 'error', 'api.request.error', {
    requestId: req.id,
    method: req.method,
    status: res.statusCode,
  });
  return errorHandler(err, req, res, next);
});

module.exports = app;
