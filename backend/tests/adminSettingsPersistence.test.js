import adminController, {
  configureSettingsPersistence,
} from '../api/controllers/adminController.js';

describe('dynamic admin settings persistence', () => {
  it('returns a stable failure and does not acknowledge rejected writes', async () => {
    configureSettingsPersistence({ save: async () => { throw new Error('storage unavailable'); } });
    const req = { body: { platformFeePercent: 2 } };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return this; },
    };
    await adminController.updateSettings(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.payload.error).toBe('storage unavailable');
  });
});
