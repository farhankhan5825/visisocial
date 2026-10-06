const { start } = require('../src/server');
test('offline server starts with no credentials or database and closes cleanly', async () => {
  const { server } = await start({ APP_MODE: 'demo', PORT: '0' });
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const r = await fetch(`http://127.0.0.1:${server.address().port}/health`); expect(await r.json()).toEqual({ status: 'ok', mode: 'offline_synthetic' });
  await new Promise(resolve => server.close(resolve));
});
test('live startup fails closed on missing configuration or insecure transport', async () => {
  await expect(start({ APP_MODE: 'live' })).rejects.toThrow('missing_live_configuration');
  const env = { APP_MODE: 'live', SESSION_SECRET: 'a'.repeat(32), TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32), FACEBOOK_APP_ID: 'test', FACEBOOK_APP_SECRET: 'test', FACEBOOK_TEST_USER_IDS: 'test', API_VERSION: 'v24.0', MONGODB_URI: 'mongodb://localhost/test', PUBLIC_ORIGIN: 'https://example.test' };
  await expect(start(env)).rejects.toThrow('live_requires_production_tls_and_strong_secret');
});
