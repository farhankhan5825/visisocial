const { createApp } = require('../src/app');
const { MemoryStore } = require('../src/privacy/store');
const { Cache } = require('../src/privacy/cache');
const { Queue } = require('../src/jobs/queue');
const { execute } = require('../eval/run');
const fs = require('node:fs');
const path = require('node:path');
let server, base, store, queue;
beforeAll(async () => {
  store = new MemoryStore();
  queue = new Queue();
  const app = createApp({
    demo: true,
    production: false,
    sessionSecret: 'test-secret-'.repeat(4),
    store,
    queue,
    cache: new Cache(),
  });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});
function client() {
  let cookie;
  return async (url, options = {}) => {
    const response = await fetch(base + url, {
      ...options,
      redirect: 'manual',
      headers: { ...(cookie ? { cookie } : {}), ...(options.headers || {}) },
    });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return response;
  };
}
const csrf = (html) => html.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
test('full consent/report/export/feedback/delete flow and removed routes', async () => {
  const request = client(),
    stranger = client();
  const home = await request('/');
  const homeHtml = await home.text();
  expect(homeHtml).toContain('authored mocks');
  expect((await request('/demo', { method: 'POST' })).status).toBe(403);
  expect(
    (
      await request('/demo', {
        method: 'POST',
        body: new URLSearchParams({ _csrf: csrf(homeHtml) }),
      })
    ).status
  ).toBe(302);
  const consentHtml = await (await request('/consent')).text();
  const token = csrf(consentHtml);
  expect(consentHtml).toContain('second model pass as judge');
  const bad = await request('/analyze', {
    method: 'POST',
    body: new URLSearchParams({ _csrf: token, timezone: 'invented/timezone' }),
  });
  expect(bad.status).toBe(400);
  const analyzed = await request('/analyze', {
    method: 'POST',
    body: new URLSearchParams({
      _csrf: token,
      timezone: 'Europe/London',
      openai: 'on',
      vision: 'on',
      hibp: 'on',
    }),
  });
  expect(analyzed.status).toBe(302);
  await queue.tail;
  const report = await request('/report');
  const html = await report.text();
  expect(report.status).toBe(200);
  expect(html).toContain('Why am I seeing this?');
  expect(html).toContain('An AI model guessed');
  for (const section of [
    'AI profile summary',
    'Profile graph',
    'Post tone',
    'Personality traits',
    'Known breaches',
    'Posting activity',
  ])
    expect(html).toContain(section);
  expect(html).toMatch(/<details class="evidence-drawer" data-evidence-drawer>/);
  expect(html).toContain('class="tone-chart"');
  expect(html).toContain('class="activity-chart"');
  const exported = await request('/export');
  const json = await exported.json();
  expect(json.metadata.mode).toBe('authored_mock_providers');
  expect(JSON.stringify(json)).not.toContain('oauth-secret');
  expect(exported.headers.get('content-disposition')).toContain('visisocial-report.json');
  expect((await stranger('/export')).status).toBe(302);
  const feedback = await request('/feedback', {
    method: 'POST',
    body: new URLSearchParams({ _csrf: token, index: '0' }),
  });
  expect(feedback.status).toBe(302);
  expect([...store.records.values()][0].feedback[0].incorrect).toBe(true);
  const deleted = await request('/delete', {
    method: 'POST',
    body: new URLSearchParams({ _csrf: token }),
  });
  expect(deleted.status).toBe(200);
  expect(store.records.size).toBe(0);
  expect((await request('/export')).status).toBe(302);
  for (const route of [
    '/debug/task-state',
    '/debug/loading-state',
    '/force-complete',
    '/test',
    '/internet-search',
    '/uploads/x',
    '/surveillance/dashboard',
  ])
    expect((await request(route)).status).toBe(404);
});
test('golden report JSON matches the released full pipeline fixture and independently planted peak', async () => {
  const expected = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'golden/p01.report.json'), 'utf8')
  );
  const actual = (await execute('p01')).report;
  expect(actual).toEqual(expected);
  // Independent of the golden file: the planted peak from the fixture source.
  const truth = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../eval/profiles/p01.truth.json'), 'utf8')
  );
  expect(actual.features['temporal.peakHours'].value).toEqual(truth.peakHours);
  const d = actual.features['text.sentiment'].value.distribution;
  expect(d.positive + d.neutral + d.negative + d.unscored).toBe(truth.posts.length);
  expect(Object.keys(actual.sources.posts)).toHaveLength(truth.posts.length);
});
test('warm cache retains provenance and consent changes cannot reuse provider output', async () => {
  const cache = new Cache();
  await execute('p01', cache);
  const warm = await execute('p01', cache);
  expect(Object.values(warm.cacheHits).filter(Boolean)).toHaveLength(6);
  expect(warm.report.features['image.observations'].n).toBe(4);
});
