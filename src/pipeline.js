'use strict';
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const { profile: profileSchema, moduleOutput } = require('./schemas');
const { synthesize } = require('./report/synthesize');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function runPipeline({ ingest, modules, explain, cache, owner, consent = {}, context = {}, failModule }) {
  const timings = {}, cacheHits = {};
  async function timed(name, fn) { const start = performance.now(); try { return await fn(); } finally { timings[name] = performance.now() - start; } }
  const profile = await timed('ingest', async () => profileSchema.parse(await ingest()));
  const outputs = {};
  // Each modality has its own failure boundary. Images finish before synthesis.
  await Promise.all(Object.entries(modules).map(async ([name, analyze]) => {
    outputs[name] = await timed(name, async () => {
      const key = hash({ schema: '3.0.0', name, profile, consent, context });
      try {
        if (failModule === name) throw new Error('injected_failure');
        const hit = cache?.get(owner, key);
        cacheHits[name] = Boolean(hit);
        if (hit) return hit;
        const output = moduleOutput.parse(await analyze(profile, consent));
        if (output.status === 'ok') cache?.set(owner, key, output);
        return output;
      } catch (err) {
        return { status: 'failed', features: {}, diagnostics: {}, error: err.message === 'injected_failure' ? 'injected_failure' : 'module_failed' };
      }
    });
  }));
  const report = await timed('synthesis', () => synthesize(outputs, { inputHash: hash(profile), timezone: profile.timezone, ...context }));
  try { report.explanations = await timed('explanation', () => explain(report.features, consent)); }
  catch { report.explanations = { sentences: [], status: 'failed', attempted: 0, flagged: 0, flaggedRate: null }; }
  return { report, timings, cacheHits };
}
module.exports = { runPipeline, hash };
