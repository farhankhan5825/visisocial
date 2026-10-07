const {
  analyzeText,
  tokenize,
  sentiment,
  readability,
  tfidf,
  topics,
  detectLanguages,
} = require('../src/analysis/text');
const { stem, matchTopics } = require('../src/analysis/taxonomy');
const profile = (posts) => ({ posts: { data: posts } });

test('no posts abstains; missing message does not invent a value', () => {
  expect(analyzeText(profile([])).features.sentiment.value).toBeNull();
  expect(analyzeText(profile([{ id: '1' }])).features.topics.status).toBe('insufficient_evidence');
});

test('VADER per-post sentiment handles negation, intensity and the 0.05 thresholds', () => {
  expect(sentiment('This is not good.').label).toBe('negative');
  expect(sentiment('Worst train journey ever. Three hours late.').label).toBe('negative');
  expect(sentiment('So proud and relieved!!').label).toBe('positive');
  expect(sentiment('The meeting is at noon.').label).toBe('neutral');
  const value = analyzeText(
    profile([{ id: 'p', message: 'I love this so much, what a great day' }])
  ).features.sentiment.value;
  expect(value.distribution.positive).toBe(1);
  expect(value.scoredN).toBe(1);
});

test('non-English text is unscored, never neutral, and unicode survives tokenization', () => {
  expect(sentiment('Me encanta la comida', 'es')).toEqual({
    label: 'unscored',
    score: null,
    language: 'es',
  });
  const r = analyzeText(
    profile([
      { id: 'a', message: 'Hoy fue un día increíble en la playa con mis amigos' },
      { id: 'b', message: 'مجھے کتابیں پڑھنا بہت پسند ہیں اور میں روز پڑھتا ہوں' },
    ])
  );
  expect(r.features.sentiment.value.distribution.unscored).toBe(2);
  expect(tokenize('Éducation کتاب')).toContain('éducation');
});

test('short posts inherit the dominant language of the same script, and say so', () => {
  const { perPost, dominant } = detectLanguages([
    { id: 'a', message: 'Lovely walk along the beach this morning with the family' },
    { id: 'b', message: 'Watched a brilliant film at the cinema last night' },
    { id: 'c', message: 'Gutted.' },
    { id: 'd', message: '😊😊' },
  ]);
  expect(dominant).toBe('en');
  expect(perPost.find((p) => p.postId === 'c')).toMatchObject({
    language: 'en',
    source: 'profile_dominant_language',
  });
  expect(perPost.find((p) => p.postId === 'd')).toMatchObject({
    language: null,
    source: 'no_linguistic_text',
  });
});

test('readability ignores emoji, counts unterminated posts as sentences and abstains on little text', () => {
  expect(readability(['This is good.'])).toBeNull();
  const posts = Array.from({ length: 5 }, () => 'This is a good day for a long walk 😊');
  const r = readability(posts);
  expect(r.sentences).toBe(5);
  expect(r.words).toBe(45);
  const syllablesPerWord = 1; // nine one-syllable words per post
  expect(r.fleschReadingEase).toBeCloseTo(206.835 - 1.015 * 9 - 84.6 * syllablesPerWord);
});

test('taxonomy matches whole words with light stemming and never substrings', () => {
  expect(matchTopics(tokenize('I said brunch in snow'))).toEqual(['food_drink']);
  expect(matchTopics(tokenize('crunchy'))).toEqual([]);
  expect(stem('running')).toBe('runn');
  expect(matchTopics(tokenize('Went running and then hiking'))).toEqual(
    expect.arrayContaining(['sports_fitness', 'nature_outdoors'])
  );
  expect(
    topics([{ id: 'a', message: 'I enjoy technology and music' }]).map((t) => t.topic)
  ).toEqual(['music', 'technology']);
});

test('topics exclude posts outside English coverage', () => {
  const languageOf = (id) => (id === 'a' ? 'en' : 'es');
  const result = topics(
    [
      { id: 'a', message: 'Football match tonight' },
      { id: 'b', message: 'Partido de football esta noche' },
    ],
    languageOf
  );
  expect(result).toEqual([{ topic: 'sports_fitness', postIds: ['a'], count: 1 }]);
});

test('TF-IDF is normalized and uses document frequency', () => {
  const items = tfidf([
    { id: 'a', message: 'robot robot common' },
    { id: 'b', message: 'common' },
  ]);
  expect(items.find((x) => x.term === 'robot').weight).toBeCloseTo((2 / 3) * (Math.log(3 / 2) + 1));
  expect(items.find((x) => x.term === 'common').postIds).toEqual(['a', 'b']);
});
