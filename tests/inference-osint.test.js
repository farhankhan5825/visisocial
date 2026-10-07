const { verifyInferences, analyzeInference } = require('../src/analysis/inference');
const { analyzeExposure } = require('../src/analysis/osint');
const item = (extra = {}) => ({
  attribute: 'location',
  guess: 'London',
  evidence: [{ postId: 'p', quote: 'I live in London' }],
  certainty: 'low',
  ...extra,
});
test('inferences reject absent ids, nonverbatim spans, empty evidence and sensitive attributes', () => {
  const posts = [{ id: 'p', message: 'I live in London.' }];
  const r = verifyInferences(
    [
      item(),
      item({ evidence: [] }),
      item({ evidence: [{ postId: 'p', quote: 'I live in Paris' }] }),
      item({ attribute: 'relationship_status' }),
      item({ evidence: [{ postId: 'wrong', quote: 'I live in London' }] }),
    ],
    posts
  );
  expect(r.accepted).toHaveLength(1);
  expect(r.rejected).toHaveLength(4);
  expect(r.rejectionRate).toBe(0.8);
});
test('empty inferences have no estimated rejection rate and model can abstain', () => {
  expect(verifyInferences([], []).rejectionRate).toBeNull();
  expect(verifyInferences([item({ guess: null })], []).rejected).toHaveLength(0);
});
test('inference does not call provider without consent or posts', async () => {
  const generate = jest.fn();
  expect((await analyzeInference({ posts: { data: [] } }, {}, generate)).status).toBe(
    'unavailable'
  );
  await analyzeInference({ posts: { data: [] } }, { openai: true }, generate);
  expect(generate).not.toHaveBeenCalled();
});

test('personality observations require separate consent and exact supporting quotes', async () => {
  const posts = [{ id: 'p', message: 'I make a detailed plan before every project.' }];
  const trait = item({
    attribute: 'conscientiousness',
    guess: 'Describes planning ahead',
    evidence: [{ postId: 'p', quote: 'I make a detailed plan' }],
  });
  const generate = jest.fn(async () => ({ items: [trait] }));
  const profile = { posts: { data: posts } };
  const disabled = await analyzeInference(profile, { openai: true }, generate);
  expect(disabled.features.guesses.value).toBeNull();
  expect(generate.mock.calls[0][1].attributes).not.toContain('conscientiousness');
  const enabled = await analyzeInference(profile, { openai: true, personality: true }, generate);
  expect(enabled.features.guesses.value).toEqual([trait]);
  expect(generate.mock.calls[1][1].attributes).toContain('conscientiousness');
  expect(
    verifyInferences(
      [{ ...trait, evidence: [{ postId: 'p', quote: 'I never plan ahead' }] }],
      posts,
      false,
      true
    ).accepted
  ).toHaveLength(0);
});

test('placeholder descriptions and numeric personality scores are rejected despite real quotes', () => {
  const posts = [{ id: 'p', message: 'I live in London.' }];
  const result = verifyInferences(
    [
      item({ attribute: 'openness', guess: 'value' }),
      item({ attribute: 'agreeableness', guess: 'value or null' }),
      item({ attribute: 'extraversion', guess: '8/10' }),
      item({ guess: '   ' }),
      item(),
    ],
    posts,
    false,
    true
  );
  expect(result.accepted).toEqual([item()]);
  expect(result.rejected.map((r) => r.reason)).toEqual(
    Array(4).fill('placeholder_or_invalid_description')
  );
});
test('only OAuth-owned matching email can query HIBP, no active account claim', async () => {
  const checkBreaches = jest.fn(async () => [
    { Name: 'MockBreach', BreachDate: '2020-01-01', DataClasses: ['Email addresses'] },
  ]);
  const profile = { email: 'self@example.test' };
  expect(
    (
      await analyzeExposure(
        profile,
        { hibp: true },
        { verifiedEmail: 'other@example.test', checkBreaches }
      )
    ).status
  ).toBe('unavailable');
  expect(checkBreaches).not.toHaveBeenCalled();
  const r = await analyzeExposure(
    profile,
    { hibp: true },
    { verifiedEmail: profile.email, checkBreaches }
  );
  expect(r.features.breaches.value[0]).toEqual({
    name: 'MockBreach',
    date: '2020-01-01',
    dataClasses: ['Email addresses'],
  });
});

test('quote matching forgives typography only, and reports why a guess was rejected', () => {
  const { verifyInferences } = require('../src/analysis/inference');
  const posts = [{ id: '1415_9921', message: 'Can\u2019t wait,  moving to   Swansea next month!' }];
  const item = (quote, postId = '1415_9921') => ({
    attribute: 'location',
    guess: 'Swansea',
    evidence: [{ postId, quote }],
    certainty: 'low',
  });
  const ok = verifyInferences([item("can't wait, moving to Swansea")], posts);
  expect(ok.accepted).toHaveLength(1);
  const bad = verifyInferences(
    [item('moving to Cardiff'), item('moving to Swansea', '1415_9922'), item('Sw')],
    posts
  );
  expect(bad.rejected.map((r) => r.reason)).toEqual([
    'quote_not_in_post',
    'unknown_post',
    'quote_too_short',
  ]);
});

test('model schemas enumerate the only valid post IDs and feature keys', () => {
  const { providerSchema } = require('../src/schemas/provider-json');
  const inf = providerSchema('inference', { posts: [{ id: 'a_1' }, { id: 'b_2' }] }).json_schema
    .schema;
  expect(inf.properties.items.items.properties.evidence.items.properties.postId.enum).toEqual([
    'a_1',
    'b_2',
  ]);
  const exp = providerSchema('explain-text', { 'text.sentiment': {}, 'text.topics': {} })
    .json_schema.schema;
  expect(exp.properties.sentences.items.properties.supportedBy.items.enum).toEqual([
    'text.sentiment',
    'text.topics',
  ]);
  expect(providerSchema('judge').json_schema.strict).toBe(true);
});
