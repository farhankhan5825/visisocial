const { createFacebook } = require('../src/ingest/facebook');
const { createModules } = require('../src/modules');
const { runPipeline } = require('../src/pipeline');
const { Cache } = require('../src/privacy/cache');
test('acquisition permission failures produce unavailable modules, never empty-observation conclusions', async () => {
  const p = { id: 'p', timezone: 'UTC', posts: { data: [] }, photos: { data: [] }, likes: { data: [] }, acquisitionErrors: ['posts', 'photos'] };
  const result = await runPipeline({ owner: 'p', ingest: async () => p, ...createModules({}, p), consent: {} });
  expect(result.report.modules.text.status).toBe('unavailable'); expect(result.report.modules.image.status).toBe('unavailable'); expect(result.report.features['interests.categories'].status).toBe('insufficient_evidence'); expect(result.report.explanations.flaggedRate).toBeNull();
});
test('cache is isolated by owner, consent and prompt metadata', async () => {
  const cache = new Cache(), analyze = jest.fn(async () => ({ status: 'ok', features: {}, diagnostics: {} }));
  const args = { cache, owner: 'a', ingest: async () => ({ id: 'synthetic' }), modules: { a: analyze }, explain: async () => ({ sentences: [] }) };
  await runPipeline({ ...args, consent: { vision: true }, context: { promptHash: 'one' } });
  await runPipeline({ ...args, consent: { vision: false }, context: { promptHash: 'one' } });
  await runPipeline({ ...args, owner: 'b', consent: { vision: true }, context: { promptHash: 'one' } });
  await runPipeline({ ...args, consent: { vision: true }, context: { promptHash: 'two' } });
  expect(analyze).toHaveBeenCalledTimes(4);
});
test('repeated cursor and identity mismatch stop ingestion', async () => {
  const graph = createFacebook({ token: 'mock', version: 'v24.0', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ id: 'wrong', data: [], paging: { next: 'next', cursors: { after: 'same' } } }) }) });
  await expect(graph.edge('posts', 'id')).rejects.toThrow('invalid_or_repeated_graph_cursor');
  await expect(graph.ingest('UTC', 'expected')).rejects.toThrow('identity_mismatch');
});
