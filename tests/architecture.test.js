const { finding } = require('../src/report/feature');
const { runPipeline } = require('../src/pipeline');
const { Queue } = require('../src/jobs/queue');
const { Cache } = require('../src/privacy/cache');
test('provenance abstains without an invented confidence', () => { expect(finding(null, 'test')).toMatchObject({ status: 'insufficient_evidence', n: 0, confidence: null }); });
test('images finish before synthesis; module failure is isolated', async () => {
  const result = await runPipeline({ owner: 'test', ingest: async () => ({ id: 'test' }), modules: { image: async () => ({ status: 'ok', features: { text: finding('read text', 'mock', ['photo']) } }), broken: () => { throw new Error('private secret'); } }, explain: async () => ({ sentences: [] }) });
  expect(result.report.features['image.text'].value).toBe('read text');
  expect(result.report.modules.broken.error).toBe('module_failed');
  expect(JSON.stringify(result)).not.toContain('private secret');
});
test('queue deduplicates jobs and draining prevents writes for deleted owners', async () => {
  const q = new Queue(); let calls = 0; const a = q.add('a', async () => ++calls); const b = q.add('a', async () => ++calls);
  expect(a).toBe(b); await a; expect(calls).toBe(1); await q.cancelAndDrain('a'); await expect(q.add('a', () => {})).rejects.toThrow('owner_deleted');
});
test('cache clones results, expires and deletes by owner', () => { const c = new Cache(-1); c.set('a', 'k', {}); expect(c.get('a', 'k')).toBeNull(); const fresh = new Cache(); fresh.set('a', 'k', { x: 1 }); const hit = fresh.get('a', 'k'); hit.x = 2; expect(fresh.get('a', 'k').x).toBe(1); fresh.deleteOwner('a'); expect(fresh.get('a', 'k')).toBeNull(); });
