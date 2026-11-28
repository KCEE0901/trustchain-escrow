import { classifyExportDeliveryFailure, retryExportDelivery } from '../lib/exportDeliveryFailure.js';

test('retries transient export delivery failures', async () => {
  const deliver = jest.fn().mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })).mockResolvedValue({ jobId: '1' });
  await expect(retryExportDelivery(deliver)).resolves.toEqual({ jobId: '1' });
  expect(deliver).toHaveBeenCalledTimes(2);
});

test('stops on malformed and terminal responses', async () => {
  expect(classifyExportDeliveryFailure(new SyntaxError('bad json'))).toEqual({ retryable: false, code: 'delivery_invalid_response' });
  const deliver = jest.fn().mockRejectedValue(new SyntaxError('bad json'));
  await expect(retryExportDelivery(deliver, 3)).rejects.toThrow('bad json');
  expect(deliver).toHaveBeenCalledTimes(1);
});
