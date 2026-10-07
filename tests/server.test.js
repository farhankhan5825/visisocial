const { start } = require('../src/server');
test('offline server starts with no credentials or database and closes cleanly', async () => {
  const { server } = await start({ APP_MODE: 'offline-test', PORT: '0' });
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  const r = await fetch(`http://127.0.0.1:${server.address().port}/health`);
  expect(await r.json()).toEqual({ status: 'ok', mode: 'offline_synthetic' });
  await new Promise((resolve) => server.close(resolve));
});
test('live startup fails closed on missing configuration or insecure transport', async () => {
  await expect(start({ APP_MODE: 'live' })).rejects.toThrow('missing_live_configuration');
  // Real mode is the default: no APP_MODE still means live, never a demo.
  await expect(start({})).rejects.toThrow('missing_live_configuration');
  const env = {
    APP_MODE: 'live',
    SESSION_SECRET: 'a'.repeat(32),
    TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32),
    FACEBOOK_APP_ID: 'test',
    FACEBOOK_APP_SECRET: 'test',
    FACEBOOK_TEST_USER_IDS: 'test',
    API_VERSION: 'v24.0',
    MONGODB_URI: 'mongodb://localhost/test',
    PUBLIC_ORIGIN: 'https://example.test',
  };
  await expect(start(env)).rejects.toThrow('live_requires_production_https_and_tls_database');
  await expect(start({ ...env, NODE_ENV: 'production' })).rejects.toThrow(
    'live_requires_production_https_and_tls_database'
  );
  await expect(start({ ...env, SESSION_SECRET: 'short' })).rejects.toThrow(
    'live_requires_strong_secret'
  );
});
test('local live mode is limited to localhost origin and database', async () => {
  const env = {
    APP_MODE: 'live',
    NODE_ENV: 'development',
    SESSION_SECRET: 'a'.repeat(32),
    TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32),
    FACEBOOK_APP_ID: 'test',
    FACEBOOK_APP_SECRET: 'test',
    FACEBOOK_TEST_USER_IDS: 'test',
    API_VERSION: 'v24.0',
    MONGODB_URI: 'mongodb://localhost:27017/visisocial',
  };
  for (const [origin, db] of [
    ['http://example.test', 'mongodb://localhost/x'],
    ['https://localhost:3001', 'mongodb://localhost/x'],
    ['http://localhost:3001', 'mongodb://db.example.test/x'],
    ['http://localhost:3001', 'mongodb+srv://cluster.example.test/x'],
  ]) {
    await expect(start({ ...env, PUBLIC_ORIGIN: origin, MONGODB_URI: db })).rejects.toThrow(
      'local_live_requires_localhost_origin_and_database'
    );
  }
});
