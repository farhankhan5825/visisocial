'use strict';
const tinyld = require('tinyld');
const { SentimentIntensityAnalyzer } = require('vader-sentiment');
const { finding } = require('../report/feature');
const { TOPICS, matchTopics } = require('./taxonomy');

const METHOD_VERSION = '2.0.0';
// Hutto & Gilbert (2014) recommend compound >= 0.05 positive, <= -0.05 negative.
const VADER_THRESHOLD = 0.05;
// tinyld scores below this are treated as unreliable (common for posts under ~5 words).
const LANGUAGE_MIN_ACCURACY = 0.3;
const READABILITY_MIN_SENTENCES = 5;
const READABILITY_MIN_WORDS = 40;

// prettier-ignore
const STOP = new Set(`a about above after again against all am an and any are as at be because been
before being below between both but by can could did do does doing down during each few for from
further had has have having he her here hers herself him himself his how i if in into is it its
itself just me more most my myself no nor not now of off on once only or other our ours ourselves out
over own same she should so some such than that the their theirs them themselves then there these
they this those through to too under until up very was we were what when where which while who whom
why will with would you your yours yourself yourselves im ive dont cant its thats get got really`
  .split(/\s+/));

const textOf = (post) => (post.message || post.story || '').trim();

function tokenize(text = '') {
  return (
    text
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) || []
  );
}

function script(text) {
  if (/[؀-ۿ]/u.test(text)) return 'arabic';
  if (/[一-鿿]/u.test(text)) return 'han';
  if (/[A-Za-zÀ-ɏ]/u.test(text)) return 'latin';
  return /\p{L}/u.test(text) ? 'other' : 'none';
}

// Per-post language with an explicit source. Short posts rarely carry enough signal
// for character n-gram detection, so they inherit the profile's dominant language
// when it is written in the same script. The inheritance is recorded, never hidden.
function detectLanguages(posts) {
  const raw = posts.map((post) => {
    const text = textOf(post);
    const s = script(text);
    if (s === 'none') return { postId: post.id, language: null, source: 'no_linguistic_text', s };
    const [top] = tinyld.detectAll(text);
    const confident = top && top.accuracy >= LANGUAGE_MIN_ACCURACY && tokenize(text).length >= 3;
    return {
      postId: post.id,
      language: confident ? top.lang : null,
      source: confident ? 'post_detection' : 'undetermined',
      accuracy: top ? top.accuracy : null,
      s,
    };
  });
  const counts = {};
  raw
    .filter((r) => r.language)
    .forEach((r) => (counts[r.language] = (counts[r.language] || 0) + 1));
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const dominant =
    ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : null;
  const dominantScript = dominant && raw.find((r) => r.language === dominant).s;
  const perPost = raw.map(({ s, ...r }) =>
    r.source === 'undetermined' && dominant && s === dominantScript
      ? { ...r, language: dominant, source: 'profile_dominant_language' }
      : r
  );
  return { dominant, counts, perPost };
}

function sentiment(text, language = 'en') {
  if (!text || !text.trim() || language !== 'en') {
    return { label: 'unscored', score: null, language: language || null };
  }
  const { compound } = SentimentIntensityAnalyzer.polarity_scores(text);
  const label =
    compound >= VADER_THRESHOLD
      ? 'positive'
      : compound <= -VADER_THRESHOLD
        ? 'negative'
        : 'neutral';
  return { label, score: compound, language };
}

function syllables(word) {
  const cleaned = word.toLowerCase().replace(/(?:es|ed|e)$/, '');
  return Math.max(1, (cleaned.match(/[aeiouy]+/g) || []).length);
}

// Flesch Reading Ease over English posts. Emoji and symbols are removed rather than
// disqualifying the corpus, and a post without terminal punctuation counts as one sentence.
function readability(texts) {
  const list = Array.isArray(texts) ? texts : [texts];
  let sentences = 0;
  const words = [];
  for (const text of list) {
    const cleaned = (text || '').replace(/[^\p{L}\p{N}\s.!?,;:'’-]/gu, ' ');
    const postWords = cleaned.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
    if (!postWords.length) continue;
    const terminated = cleaned.match(/[^.!?]*[A-Za-z][^.!?]*[.!?]+/g) || [];
    const trailing = cleaned.replace(/[^.!?]*[.!?]+/g, '');
    sentences += terminated.length + (/[A-Za-z]/.test(trailing) ? 1 : 0);
    words.push(...postWords);
  }
  if (sentences < READABILITY_MIN_SENTENCES || words.length < READABILITY_MIN_WORDS) return null;
  const syllableCount = words.reduce((n, w) => n + syllables(w), 0);
  return {
    fleschReadingEase:
      206.835 - (1.015 * words.length) / sentences - (84.6 * syllableCount) / words.length,
    sentences,
    words: words.length,
  };
}

function tfidf(posts) {
  const docs = posts.map((p) =>
    tokenize(textOf(p)).filter((t) => !STOP.has(t) && t.length > 2 && /\p{L}/u.test(t))
  );
  const df = new Map();
  docs.forEach((tokens) => new Set(tokens).forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
  const weights = new Map();
  docs.forEach((tokens) => {
    const freq = new Map();
    tokens.forEach((t) => freq.set(t, (freq.get(t) || 0) + 1));
    for (const [t, count] of freq) {
      const idf = Math.log((1 + docs.length) / (1 + df.get(t))) + 1;
      weights.set(t, (weights.get(t) || 0) + (count / tokens.length) * idf);
    }
  });
  return [...weights]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 15)
    .map(([term, weight]) => ({
      term,
      weight,
      postIds: posts.filter((_, i) => docs[i].includes(term)).map((p) => p.id),
    }));
}

// Topics are assigned per post (multi-label) and then aggregated. Only English posts are
// in coverage; the number of posts outside coverage is reported alongside the result.
function topics(posts, languageOf = () => 'en') {
  const byTopic = new Map();
  for (const post of posts) {
    if (languageOf(post.id) !== 'en') continue;
    for (const topic of matchTopics(tokenize(textOf(post)))) {
      if (!byTopic.has(topic)) byTopic.set(topic, []);
      byTopic.get(topic).push(post.id);
    }
  }
  return [...byTopic]
    .map(([topic, postIds]) => ({ topic, postIds, count: postIds.length }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
}

function analyzeText(profile) {
  const posts = profile.posts.data.filter((p) => textOf(p));
  const ids = posts.map((p) => p.id);
  const languages = detectLanguages(posts);
  const languageById = new Map(languages.perPost.map((l) => [l.postId, l.language]));
  const languageOf = (id) => languageById.get(id);
  const english = posts.filter((p) => languageOf(p.id) === 'en');

  const scored = posts.map((p) => ({ postId: p.id, ...sentiment(textOf(p), languageOf(p.id)) }));
  const valid = scored.filter((p) => p.score !== null);
  const distribution = { positive: 0, neutral: 0, negative: 0, unscored: 0 };
  scored.forEach((p) => distribution[p.label]++);
  const mean = valid.length ? valid.reduce((n, p) => n + p.score, 0) / valid.length : null;
  const topicList = posts.length ? topics(posts, languageOf) : null;
  const v = { methodVersion: METHOD_VERSION };

  return {
    status: 'ok',
    features: {
      sentiment: finding(
        posts.length ? { distribution, mean, scoredN: valid.length, posts: scored } : null,
        'per_post_vader_compound_english',
        ids,
        [
          'VADER (Hutto & Gilbert, 2014) lexicon and rules; compound >= 0.05 is positive and <= -0.05 negative.',
          'Only posts detected as English are scored; other languages are unscored, not neutral.',
          'Sarcasm, slang and context are handled poorly; this describes wording, not mood or mental state.',
        ],
        v
      ),
      readability: finding(
        readability(english.map(textOf)),
        'flesch_reading_ease_english_posts',
        english.map((p) => p.id),
        [
          `Requires at least ${READABILITY_MIN_SENTENCES} sentences and ${READABILITY_MIN_WORDS} words of English text.`,
          'Heuristic syllable count; short informal posts make the score unstable. Not an education estimate.',
        ],
        v
      ),
      keywords: finding(
        posts.length ? tfidf(posts) : null,
        'tf_normalized_smoothed_idf_across_posts',
        ids,
        [
          'English stopword list; keywords are frequent distinctive words, not inferred attributes.',
        ],
        v
      ),
      topics: finding(
        topicList && topicList.length ? topicList : null,
        'per_post_english_keyword_taxonomy',
        english.map((p) => p.id),
        [
          `${Object.keys(TOPICS).length}-topic project taxonomy, matched on whole words with light suffix stripping.`,
          `${posts.length - english.length} of ${posts.length} posts are not English and fall outside topic coverage.`,
        ],
        v
      ),
      languages: finding(
        posts.length ? languages : null,
        'tinyld_ngram_with_profile_dominant_fallback',
        ids,
        [
          `Per-post detection accepted at accuracy >= ${LANGUAGE_MIN_ACCURACY} with 3+ words; shorter posts inherit the dominant language of the same script.`,
          'Named-entity recognition is not implemented.',
        ],
        v
      ),
    },
    diagnostics: {
      englishPosts: english.length,
      nonEnglishPosts: posts.length - english.length,
      dominantLanguage: languages.dominant,
    },
  };
}

module.exports = {
  analyzeText,
  tokenize,
  sentiment,
  readability,
  tfidf,
  topics,
  detectLanguages,
  script,
};
