'use strict';
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const { profile: profileSchema, moduleOutput } = require('./schemas');
const { synthesize } = require('./report/synthesize');
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function runPipeline({
  ingest,
  modules,
  explain,
  cache,
  owner,
  consent = {},
  context = {},
  failModule,
}) {
  const timings = {},
    cacheHits = {};
  async function timed(name, fn) {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      timings[name] = performance.now() - start;
    }
  }
  const profile = await timed('ingest', async () => profileSchema.parse(await ingest()));
  const outputs = {};
  // Each modality has its own failure boundary. Images finish before synthesis.
  await Promise.all(
    Object.entries(modules).map(async ([name, analyze]) => {
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
          return {
            status: 'failed',
            features: {},
            diagnostics: {},
            // Our own snake_case codes (e.g. hibp_key_rejected) are safe to keep; anything else
            // could carry provider text, so it collapses to a generic code.
            error: /^[a-z][a-z0-9_]{2,60}$/.test(err?.message || '')
              ? err.message
              : 'module_failed',
          };
        }
      });
    })
  );
  const report = await timed('synthesis', () =>
    synthesize(outputs, { inputHash: hash(profile), timezone: profile.timezone, ...context })
  );
  // Short excerpts of the user's own items, so the report can show evidence in words
  // rather than bare IDs. Held under the same retention and deletion as the report.
  report.sources = {
    posts: Object.fromEntries(
      profile.posts.data
        .filter((p) => p.message || p.story)
        .map((p) => [
          p.id,
          { text: (p.message || p.story).slice(0, 280), time: p.created_time || null },
        ])
    ),
    likes: Object.fromEntries(
      profile.likes.data.map((l) => [l.id, { name: l.name, category: l.category || null }])
    ),
  };
  try {
    report.explanations = await timed('explanation', () => explain(report.features, consent));
  } catch {
    report.explanations = {
      sentences: [],
      status: 'failed',
      attempted: 0,
      flagged: 0,
      flaggedRate: null,
    };
  }
  return { report, timings, cacheHits };
}
module.exports = { runPipeline, hash };
