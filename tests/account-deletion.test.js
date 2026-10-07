const { createApp } = require('../src/app');
const { MemoryStore } = require('../src/privacy/store');
const { Cache } = require('../src/privacy/cache');
const { Queue } = require('../src/jobs/queue');
const session = require('express-session');
test('two OAuth sessions share an account record; deleting it revokes both sessions', async () => {
  const store = new MemoryStore(),
    sessionStore = new session.MemoryStore(),
    queue = new Queue(),
    realFetch = global.fetch;
  const env = {
    API_VERSION: 'v24.0',
    FACEBOOK_APP_ID: 'test',
    FACEBOOK_APP_SECRET: 'test',
    FACEBOOK_TEST_USER_IDS: 'owned-test-account',
  };
  const deleteSessions = (owner) =>
    new Promise((resolve, reject) =>
      sessionStore.all((err, sessions) => {
        if (err) return reject(err);
        Promise.all(
          Object.entries(sessions)
            .filter(([, value]) => value.owner === owner)
            .map(([id]) => new Promise((done) => sessionStore.destroy(id, done)))
        ).then(resolve, reject);
      })
    );
  const app = createApp({
    demo: false,
    production: true,
    origin: 'https://example.test',
    env,
    sessionSecret: 'test-secret-'.repeat(4),
    tokenKey: Buffer.alloc(32, 1),
    store,
    sessionStore,
    queue,
    cache: new Cache(),
    deleteSessions,
  });
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    status: 200,
    json: async () =>
      String(url).includes('/oauth/access_token')
        ? { access_token: 'test-token' }
        : { id: 'owned-test-account', name: 'Synthetic test owner', email: 'test@example.test' },
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const makeClient = () => {
    let cookie;
    return async (url, options = {}) => {
      const response = await realFetch(base + url, {
        ...options,
        redirect: 'manual',
        headers: { 'x-forwarded-proto': 'https', ...(cookie ? { cookie } : {}) },
      });
      if (response.headers.get('set-cookie')) {
        const set = response.headers.get('set-cookie');
        if (!set.startsWith('visisocial.sid=;')) expect(set).toContain('Secure');
        cookie = set.split(';')[0];
      }
      return response;
    };
  };
  try {
    const a = makeClient(),
      b = makeClient();
    for (const request of [a, b]) {
      const start = await request('/auth/facebook'),
        state = new URL(start.headers.get('location')).searchParams.get('state');
      expect(
        (
          await request(
            '/auth/facebook/callback?' + new URLSearchParams({ code: 'synthetic-code', state })
          )
        ).status
      ).toBe(302);
    }
    expect(store.records.size).toBe(1);
    expect((await b('/consent')).status).toBe(200);
    const html = await (await a('/consent')).text(),
      csrf = html.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
    expect(
      (await a('/delete', { method: 'POST', body: new URLSearchParams({ _csrf: csrf }) })).status
    ).toBe(200);
    expect(store.records.size).toBe(0);
    expect((await b('/consent')).status).toBe(302);
  } finally {
    global.fetch = realFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});
