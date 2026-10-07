const { createFacebook } = require('../src/ingest/facebook');
const { createModules } = require('../src/modules');
const { runPipeline } = require('../src/pipeline');
const { Cache } = require('../src/privacy/cache');
test('acquisition permission failures produce unavailable modules, never empty-observation conclusions', async () => {
  const p = {
    id: 'p',
    timezone: 'UTC',
    posts: { data: [] },
    photos: { data: [] },
    likes: { data: [] },
    acquisitionErrors: ['posts', 'photos'],
  };
  const result = await runPipeline({
    owner: 'p',
    ingest: async () => p,
    ...createModules({}, p),
    consent: {},
  });
  expect(result.report.modules.text.status).toBe('unavailable');
  expect(result.report.modules.image.status).toBe('unavailable');
  expect(result.report.features['interests.categories'].status).toBe('insufficient_evidence');
  expect(result.report.explanations.flaggedRate).toBeNull();
});
test('cache is isolated by owner, consent and prompt metadata', async () => {
  const cache = new Cache(),
    analyze = jest.fn(async () => ({ status: 'ok', features: {}, diagnostics: {} }));
  const args = {
    cache,
    owner: 'a',
    ingest: async () => ({ id: 'synthetic' }),
    modules: { a: analyze },
    explain: async () => ({ sentences: [] }),
  };
  await runPipeline({ ...args, consent: { vision: true }, context: { promptHash: 'one' } });
  await runPipeline({ ...args, consent: { vision: false }, context: { promptHash: 'one' } });
  await runPipeline({
    ...args,
    owner: 'b',
    consent: { vision: true },
    context: { promptHash: 'one' },
  });
  await runPipeline({ ...args, consent: { vision: true }, context: { promptHash: 'two' } });
  expect(analyze).toHaveBeenCalledTimes(4);
});
test('repeated cursor and identity mismatch stop ingestion', async () => {
  const graph = createFacebook({
    token: 'mock',
    version: 'v24.0',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'wrong',
        data: [{ id: 'x' }],
        paging: { next: 'next', cursors: { after: 'same' } },
      }),
    }),
  });
  await expect(graph.edge('likes', 'id')).rejects.toThrow('repeated_graph_page');
  await expect(graph.ingest('UTC', 'expected')).rejects.toThrow('identity_mismatch');
});

test('time-based paging (posts) follows until/__paging_token and ignores other next-URL params', async () => {
  const requested = [];
  const pages = [
    {
      data: [{ id: 'p1' }],
      paging: {
        next: 'https://graph.facebook.com/v24.0/12345/posts?fields=id&limit=100&access_token=LEAK&until=1700000000&__paging_token=tok1&redirect=https://evil.test',
      },
    },
    {
      data: [{ id: 'p2' }],
      paging: {
        next: 'https://graph.facebook.com/v24.0/12345/posts?until=1600000000&__paging_token=tok2',
      },
    },
    { data: [], paging: {} },
  ];
  const graph = createFacebook({
    token: 'mock',
    version: 'v24.0',
    fetchImpl: async (url) => {
      requested.push(url);
      return { ok: true, status: 200, json: async () => pages[requested.length - 1] };
    },
  });
  expect((await graph.edge('posts', 'id')).data.map((p) => p.id)).toEqual(['p1', 'p2']);
  expect(requested).toHaveLength(3);
  expect(requested[1].hostname).toBe('graph.facebook.com');
  expect(requested[1].pathname).toBe('/v24.0/me/posts');
  expect(requested[1].searchParams.get('until')).toBe('1700000000');
  expect(requested[1].searchParams.get('__paging_token')).toBe('tok1');
  expect(requested[1].searchParams.has('access_token')).toBe(false);
  expect(requested[1].searchParams.has('redirect')).toBe(false);
});

test('a next URL pointing elsewhere is refused and the Graph error code is kept', async () => {
  for (const next of [
    'https://evil.test/v24.0/1/posts?until=1',
    'https://graph.facebook.com/v23.0/1/posts?until=1',
    'https://graph.facebook.com/v24.0/1/likes?until=1',
    'https://graph.facebook.com/v24.0/1/posts?limit=5',
  ]) {
    const graph = createFacebook({
      token: 'mock',
      version: 'v24.0',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'a' }], paging: { next } }),
      }),
    });
    await expect(graph.edge('posts', 'id')).rejects.toThrow('invalid_graph_next_url');
  }
  const denied = createFacebook({
    token: 'mock',
    version: 'v24.0',
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 200, message: 'user text that must not be kept' } }),
    }),
  });
  await expect(denied.edge('posts', 'id')).rejects.toThrow(/^graph_request_failed_200$/);
});
