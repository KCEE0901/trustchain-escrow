import supertest from 'supertest';

const MAX_BATCH_SIZE = parseInt(process.env.MAX_BATCH_SIZE || '20', 10);
const MAX_ITEM_BODY_BYTES = parseInt(
  process.env.MAX_BATCH_ITEM_BODY_BYTES || String(64 * 1024),
  10,
);
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

// Routes that the batch endpoint is allowed to proxy. Anything not on this
// list is rejected so the batch endpoint cannot be used as an open relay to
// internal-only paths (e.g. /admin, /internal/*, health-check endpoints).
const BATCH_ALLOWED_ROUTES = new Set(
  (
    process.env.BATCH_ALLOWED_ROUTES ||
    [
      '/api/escrows',
      '/api/milestones',
      '/api/disputes',
      '/api/users',
      '/api/reputation',
      '/api/search',
      '/api/v1/escrows',
      '/api/v1/milestones',
      '/api/v1/disputes',
      '/api/v1/users',
      '/api/v1/reputation',
      '/api/v1/notifications',
      '/api/v1/payments',
    ].join(',')
  ).split(','),
);

/**
 * Maps an HTTP status code or response payload to a stable failure code string.
 */
function getFailureCode(status, data) {
  if (data?.error?.code && typeof data.error.code === 'string') return data.error.code;
  if (data?.code && typeof data.code === 'string') return data.code;
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 405:
      return 'METHOD_NOT_ALLOWED';
    case 409:
      return 'CONFLICT';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 415:
      return 'UNSUPPORTED_MEDIA_TYPE';
    case 422:
      return 'UNPROCESSABLE_ENTITY';
    case 429:
      return 'TOO_MANY_REQUESTS';
    case 500:
      return 'INTERNAL_SERVER_ERROR';
    case 502:
      return 'BAD_GATEWAY';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    default:
      return `HTTP_${status}`;
  }
}

/**
 * Extracts a human-readable failure reason from response payload or defaults.
 */
function getFailureReason(status, data, defaultMsg) {
  if (typeof data?.error === 'string') return data.error;
  if (data?.error?.message && typeof data.error.message === 'string') return data.error.message;
  if (typeof data?.message === 'string') return data.message;
  return defaultMsg || `Request failed with HTTP status ${status}`;
}

async function dispatchRequest(app, { method = 'GET', url, body, headers = {} }, parentReq) {
  const upperMethod = method.toUpperCase();
  if (!ALLOWED_METHODS.has(upperMethod)) {
    return {
      success: false,
      failureCode: 'METHOD_NOT_ALLOWED',
      reason: `Method not allowed: ${method}`,
      status: 400,
      data: { error: `Method not allowed: ${method}` },
      headers: {},
    };
  }

  const urlPath = url.split('?')[0];
  const isAllowed = [...BATCH_ALLOWED_ROUTES].some((prefix) => urlPath.startsWith(prefix));
  if (!isAllowed) {
    return {
      success: false,
      failureCode: 'FORBIDDEN',
      reason: `Route not permitted in batch: ${urlPath}`,
      status: 403,
      data: { error: `Route not permitted in batch: ${urlPath}` },
      headers: {},
    };
  }

  if (body !== undefined) {
    const bodySize = Buffer.byteLength(JSON.stringify(body), 'utf8');
    if (bodySize > MAX_ITEM_BODY_BYTES) {
      return {
        success: false,
        failureCode: 'PAYLOAD_TOO_LARGE',
        reason: `Batch item body too large (${bodySize} bytes, max ${MAX_ITEM_BODY_BYTES})`,
        status: 413,
        data: {
          error: `Batch item body too large (${bodySize} bytes, max ${MAX_ITEM_BODY_BYTES})`,
        },
        headers: {},
      };
    }
  }

  // Propagate parent auth unless the sub-request overrides it
  const authHeader = parentReq.headers['authorization'];
  if (authHeader && !headers['authorization'] && !headers['Authorization']) {
    headers = { ...headers, authorization: authHeader };
  }

  try {
    const agent = supertest(app)[upperMethod.toLowerCase()](url);

    for (const [key, value] of Object.entries(headers)) {
      agent.set(key, value);
    }

    if (body && (upperMethod === 'POST' || upperMethod === 'PUT' || upperMethod === 'PATCH')) {
      agent.send(body);
    }

    const response = await agent;
    const isSuccess = response.status >= 200 && response.status < 300;

    return {
      success: isSuccess,
      failureCode: isSuccess ? null : getFailureCode(response.status, response.body),
      reason: isSuccess ? null : getFailureReason(response.status, response.body),
      status: response.status,
      data: response.body,
      headers: response.headers,
    };
  } catch (err) {
    return {
      success: false,
      failureCode: 'INTERNAL_SERVER_ERROR',
      reason: err.message || 'Internal error',
      status: 500,
      data: { error: err.message },
      headers: {},
    };
  }
}

export async function handleBatch(req, res) {
  const requests = req.body;

  if (!Array.isArray(requests)) {
    return res.status(400).json({ error: 'Request body must be an array.' });
  }

  if (requests.length > MAX_BATCH_SIZE) {
    return res.status(413).json({
      error: `Batch size ${requests.length} exceeds maximum allowed (${MAX_BATCH_SIZE}).`,
    });
  }

  const results = await Promise.allSettled(
    requests.map((item) => dispatchRequest(req.app, item, req)),
  );

  const responses = results.map((result) =>
    result.status === 'fulfilled'
      ? result.value
      : {
          success: false,
          failureCode: 'INTERNAL_SERVER_ERROR',
          reason: result.reason?.message || 'Internal error',
          status: 500,
          data: { error: result.reason?.message || 'Internal error' },
          headers: {},
        },
  );

  return res.status(200).json(responses);
}
