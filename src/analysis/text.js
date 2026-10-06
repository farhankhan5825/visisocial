'use strict';
const { finding } = require('../report/feature');
const TAXONOMY = { technology: ['technology', 'computer', 'software', 'coding', 'robot'], education: ['education', 'school', 'learning', 'teacher', 'university'], travel: ['travel', 'trip', 'airport', 'holiday'], food: ['food', 'cooking', 'recipe', 'restaurant'], sports: ['sports', 'football', 'tennis', 'running'], arts: ['art', 'music', 'painting', 'concert'] };
// Small released English lexicon; exploratory, not VADER or a clinical measure.
const LEXICON = { good: 1, great: 2, love: 2, happy: 2, excellent: 2, enjoy: 1, bad: -1, hate: -2, sad: -2, awful: -2, terrible: -2, '😊': 1, '😀': 1, '😢': -1, '😡': -1 };
const STOP = new Set('a an the and or but i you we they it is are was were my your in on at to of for with this that have not no never'.split(' '));
function tokenize(text = '') { return (text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+|[😊😀😢😡]/gu) || []); }
function language(text) {
  if (!/\p{L}/u.test(text)) return 'no_linguistic_text';
  if (/[\u0600-\u06ff]/u.test(text)) return 'arabic_script_unknown_language';
  if (/[\u4e00-\u9fff]/u.test(text)) return 'han_script_unknown_language';
  const tokens = tokenize(text);
  return tokens.some(t => ['the', 'this', 'is', 'my', 'i', 'and', 'with', 'we', 'love', 'good', 'not'].includes(t)) ? 'english_heuristic' : 'unknown';
}
function sentiment(text) {
  const tokens = tokenize(text), lang = language(text);
  if (!['english_heuristic', 'no_linguistic_text'].includes(lang) || !tokens.length) return { label: 'unscored', score: null, language: lang };
  let sum = 0;
  tokens.forEach((token, i) => { let val = LEXICON[token] || 0; if (tokens.slice(Math.max(0, i - 3), i).filter(w => ['not', 'no', 'never'].includes(w)).length % 2) val *= -1; sum += val; });
  return { label: sum > 0 ? 'positive' : sum < 0 ? 'negative' : 'neutral', score: sum, language: lang };
}
function syllables(word) { const cleaned = word.toLowerCase().replace(/(?:es|ed|e)$/, ''); return Math.max(1, (cleaned.match(/[aeiouy]+/g) || []).length); }
function readability(text, minSentences = 3) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  const words = text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || [];
  if (language(text) !== 'english_heuristic' || /[^\x00-\x7f]/.test(text) || sentences.length < minSentences || !words.length) return null;
  return { fleschReadingEase: 206.835 - 1.015 * words.length / sentences.length - 84.6 * words.reduce((n, w) => n + syllables(w), 0) / words.length, sentences: sentences.length, words: words.length };
}
function tfidf(posts) {
  const docs = posts.map(p => tokenize(p.message || p.story || '').filter(t => !STOP.has(t) && /\p{L}/u.test(t)));
  const df = new Map(); docs.forEach(tokens => new Set(tokens).forEach(t => df.set(t, (df.get(t) || 0) + 1)));
  const weights = new Map(); docs.forEach(tokens => { const freq = new Map(); tokens.forEach(t => freq.set(t, (freq.get(t) || 0) + 1)); for (const [t, count] of freq) { weights.set(t, (weights.get(t) || 0) + count / tokens.length * (Math.log((1 + docs.length) / (1 + df.get(t))) + 1)); } });
  return [...weights].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 15).map(([term, weight]) => ({ term, weight, postIds: posts.filter((_, i) => docs[i].includes(term)).map(p => p.id) }));
}
function topics(posts) {
  return Object.entries(TAXONOMY).flatMap(([topic, words]) => { const ids = posts.filter(p => tokenize(p.message || p.story || '').some(t => words.includes(t))).map(p => p.id); return ids.length ? [{ topic, postIds: ids, count: ids.length }] : []; });
}
function analyzeText(profile) {
  const posts = profile.posts.data.filter(p => (p.message || p.story || '').trim());
  const ids = posts.map(p => p.id), scored = posts.map(p => ({ postId: p.id, ...sentiment(p.message || p.story) }));
  const valid = scored.filter(p => p.score !== null), distribution = { positive: 0, neutral: 0, negative: 0, unscored: 0 };
  scored.forEach(p => distribution[p.label]++);
  const limitations = ['Exploratory English lexicon, three-token negation window and four emoji; sarcasm, mixed languages and demographics are unvalidated. Unscored text is not neutral.'];
  return { status: 'ok', features: {
    sentiment: finding(posts.length ? { distribution, mean: valid.length ? valid.reduce((n, p) => n + p.score, 0) / valid.length : null, scoredN: valid.length, posts: scored } : null, 'per_post_english_lexicon_v1', ids, limitations),
    readability: finding(readability(posts.map(p => p.message || p.story).join(' ')), 'raw_text_flesch_reading_ease', ids, ['Exploratory syllable heuristic; ASCII English only; at least three punctuated sentences; not education level.']),
    keywords: finding(posts.length ? tfidf(posts) : null, 'tf_normalized_smoothed_idf_across_posts', ids, ['Stopwords are English; keywords are not inferred attributes.']),
    topics: finding(posts.length ? topics(posts) : null, 'fixed_six_topic_word_boundary_taxonomy', ids, ['Released project taxonomy, not IAB; English word rules miss other languages and context.']),
    languages: finding(posts.length ? scored.map(p => ({ postId: p.postId, language: p.language })) : null, 'script_and_english_anchor_heuristic', ids, ['Exploratory script/anchor detection; not a validated language classifier. NER is not implemented.'])
  }, diagnostics: {} };
}
module.exports = { analyzeText, tokenize, sentiment, readability, tfidf, topics, language, TAXONOMY };
