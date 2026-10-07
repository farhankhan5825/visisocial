const fs = require('node:fs');
const path = require('node:path');
const { present } = require('../src/report/present');

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden/p01.report.json'), 'utf8'));
const strings = (value) =>
  typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(strings)
      : value && typeof value === 'object'
        ? Object.values(value).flatMap(strings)
        : [];

test('every presented sentence is filled from real values', () => {
  const text = strings(present(golden)).join('\n');
  expect(text).not.toMatch(/undefined|NaN|null|\[object Object\]/);
  expect(text).not.toMatch(/\b1 posts\b|\b1 other guesses\b|\b1 likes\b/);
});

test('timing and tone sections are derived from the feature values', () => {
  const view = present(golden);
  const peak = golden.features['temporal.peakHours'].value[0];
  expect(view.timing.sentences[0]).toContain(`${String(peak).padStart(2, '0')}:00`);
  expect(view.timing.bars).toHaveLength(24);
  const d = golden.features['text.sentiment'].value.distribution;
  expect(view.tone.sentences[0]).toContain(`${d.positive} read as positive`);
  const widths = view.tone.segments.reduce((n, s) => n + s.width, 0);
  expect(widths).toBeCloseTo(100);
});

test('topic examples quote the user’s own posts from report sources', () => {
  const view = present(golden);
  const allText = Object.values(golden.sources.posts).map((p) => p.text);
  for (const item of view.topics.items) {
    for (const example of item.examples) {
      expect(allText.some((t) => t.startsWith(example.replace(/…$/, '')))).toBe(true);
    }
  }
});

test('missing consent and insufficient evidence produce explanations, not numbers', () => {
  const report = structuredClone(golden);
  report.modules.osint = {
    status: 'unavailable',
    features: {},
    diagnostics: { reason: 'hibp_not_consented' },
  };
  delete report.features['osint.breaches'];
  report.features['temporal.peakHours'] = {
    ...report.features['temporal.peakHours'],
    status: 'insufficient_evidence',
    value: null,
  };
  report.modules.temporal.diagnostics = { validN: 4, minN: 10 };
  const view = present(report);
  expect(view.breaches).toEqual({
    failed: false,
    available: false,
    message: 'Your email was not checked for breaches because you did not consent.',
  });
  expect(view.timing.message).toBe(
    'Not enough dated posts to describe when you post (4 found, 10 needed).'
  );
});

test('the live failure from 2026-10-06 is explained honestly, never as missing consent', () => {
  const report = structuredClone(golden);
  const postsDown = {
    status: 'unavailable',
    features: {},
    diagnostics: { reason: 'posts_acquisition_failed', code: 'invalid_or_repeated_graph_cursor' },
  };
  report.modules.text = postsDown;
  report.modules.temporal = postsDown;
  report.modules.inference = postsDown;
  report.modules.image = {
    status: 'failed',
    features: {},
    diagnostics: {
      failures: 15,
      attempted: 15,
      failureCodes: { 'vision:photo_address_not_public': 15 },
    },
  };
  report.modules.osint = {
    status: 'failed',
    features: {},
    diagnostics: {},
    error: 'hibp_key_rejected',
  };
  report.explanations = {
    status: 'ok',
    sentences: [],
    attempted: 0,
    flagged: 0,
    sectionFailures: ['interests'],
    sectionFailureCodes: { interests: 'llm_http_404' },
  };
  for (const k of Object.keys(report.features))
    if (!k.startsWith('interests.')) delete report.features[k];
  const view = present(report);
  const text = strings(view).join('\n');
  expect(text).not.toMatch(/did not consent|did not allow/);
  expect(view.tone.message).toMatch(/Your posts could not be fetched from Facebook/);
  expect(view.topics.message).toBe(view.tone.message);
  expect(view.timing.message).toBe(view.tone.message);
  expect(view.guesses.message).toBe(view.tone.message);
  expect(view.writing).toEqual([]);
  expect(view.photos.message).toMatch(/None of 15 photos could be downloaded/);
  expect(view.breaches.message).toMatch(/rejected the configured API key/);
  expect(view.explanations).toMatchObject({ failed: true });
  expect(view.explanations.message).toMatch(/model is not available to this API key/);
  expect(view.interests.available).toBe(true);
});

test('missing permission and expired login get specific advice', () => {
  const report = structuredClone(golden);
  report.modules.text = {
    status: 'unavailable',
    features: {},
    diagnostics: { reason: 'posts_acquisition_failed', code: 'graph_request_failed_200' },
  };
  expect(present(report).tone.message).toBe(
    'Facebook refused access to your posts (a permission was not granted).'
  );
  report.modules.text.diagnostics.code = 'graph_request_failed_190';
  expect(present(report).tone.message).toMatch(/login has expired/);
  report.modules.inference = {
    status: 'unavailable',
    features: {},
    diagnostics: { reason: 'openai_not_consented' },
  };
  expect(present(report).guesses.message).toMatch(/did not allow sending posts to OpenAI/);
});
