import {
  parseApiResponse,
  preserveApiErrorCode,
} from '../lib/api';

describe('mobile API response parsing', () => {
  it('unwraps successful response envelopes', () => {
    const payload = { id: 'escrow-1', status: 'Active' };

    expect(parseApiResponse({
      data: payload,
      meta: { requestId: 'request-1', version: 'v1' },
    })).toEqual(payload);
  });

  it.each([
    [400, 'VALIDATION_ERROR', 'Invalid request', { error: { code: 'VALIDATION_ERROR', message: 'Invalid request' } }],
    [401, 'UNAUTHORIZED', 'Authentication required', { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }],
    [429, 'RATE_LIMIT_EXCEEDED', 'Too many requests', { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' }],
  ])('preserves API details for HTTP %s errors', (status, code, message, responseData) => {
    const error = Object.assign(new Error('Request failed'), {
      isAxiosError: true,
      response: { status, data: responseData },
    });

    preserveApiErrorCode(error);

    expect(error).toMatchObject({ apiCode: code, message });
    expect(error.response.data).toBe(responseData);
  });
});