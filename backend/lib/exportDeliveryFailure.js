export function classifyExportDeliveryFailure(error) {
  if (error?.name === 'AbortError' || error?.code === 'ETIMEDOUT') return { retryable: true, code: 'delivery_timeout' };
  if (error?.code === 'ECONNRESET' || error?.status >= 500) return { retryable: true, code: 'delivery_unavailable' };
  if (error instanceof SyntaxError || error?.code === 'INVALID_RESPONSE') return { retryable: false, code: 'delivery_invalid_response' };
  return { retryable: false, code: 'delivery_failed' };
}

export async function retryExportDelivery(deliver, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await deliver(); } catch (error) {
      lastError = error;
      if (!classifyExportDeliveryFailure(error).retryable) break;
    }
  }
  throw lastError;
}
