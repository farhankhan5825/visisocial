'use strict';
// Secondary analysis of a saved evaluation run: baselines, confusion matrices, per-persona
// results and persona-level bootstrap intervals. Posts are nested in personas, so the Wilson
// intervals in summary.json (which treat posts as independent) are reported alongside
// intervals from resampling whole personas. Usage: node eval/analyze.js [runId]
const fs = require('node:fs');
const path = require('node:path');
const { wilson } = require('./metrics');

const SENTIMENT = ['positive', 'neutral', 'negative'];
const B = 10000;

// Small seeded generator so the bootstrap gives the same intervals on every machine.
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function macroF1(rows, labels) {
  const f1s = labels.map((label) => {
    const tp = rows.filter((r) => r.truth === label && r.predicted === label).length;
    const fp = rows.filter((r) => r.truth !== label && r.predicted === label).length;
    const fn = rows.filter((r) => r.truth === label && r.predicted !== label).length;
    return tp ? (2 * tp) / (2 * tp + fp + fn) : 0;
  });
  return f1s.reduce((a, b) => a + b, 0) / labels.length;
}

function confusion(rows, truthLabels, predictedLabels) {
  const m = Object.fromEntries(
    truthLabels.map((t) => [t, Object.fromEntries(predictedLabels.map((p) => [p, 0]))])
  );
  rows.forEach((r) => m[r.truth][r.predicted]++);
  return m;
}

const ratio = (a, b) => (b ? a / b : null);

// Metrics computed from a list of persona records, so that the bootstrap can recompute
// them on any resample of personas.
function metrics(personas) {
  const language = personas.flatMap((p) => p.rows.language);
  const english = personas.flatMap((p) => p.rows.sentiment.filter((r) => r.truthLanguage === 'en'));
  const scored = english.filter((r) => r.predicted !== 'unscored');
  const sum = (key, field) => personas.reduce((n, p) => n + p[key][field], 0);
  const topics = {
    tp: sum('postTopics', 'tp'),
    fp: sum('postTopics', 'fp'),
    fn: sum('postTopics', 'fn'),
  };
  const likes = {
    tp: sum('likeTopics', 'tp'),
    fp: sum('likeTopics', 'fp'),
    fn: sum('likeTopics', 'fn'),
  };
  return {
    languageAccuracy: ratio(
      language.filter((r) => r.truth === r.predicted).length,
      language.length
    ),
    sentimentAccuracy: ratio(scored.filter((r) => r.truth === r.predicted).length, scored.length),
    sentimentMacroF1: scored.length ? macroF1(scored, SENTIMENT) : null,
    postTopicPrecision: ratio(topics.tp, topics.tp + topics.fp),
    postTopicRecall: ratio(topics.tp, topics.tp + topics.fn),
    likeTopicPrecision: ratio(likes.tp, likes.tp + likes.fp),
    likeTopicRecall: ratio(likes.tp, likes.tp + likes.fn),
  };
}

function bootstrap(personas) {
  const random = mulberry32(20261007);
  const draws = Object.fromEntries(Object.keys(metrics(personas)).map((k) => [k, []]));
  for (let b = 0; b < B; b++) {
    const sample = personas.map(() => personas[Math.floor(random() * personas.length)]);
    const m = metrics(sample);
    for (const [k, v] of Object.entries(m)) if (v !== null) draws[k].push(v);
  }
  const point = metrics(personas);
  return Object.fromEntries(
    Object.entries(draws).map(([k, values]) => {
      values.sort((a, b) => a - b);
      const q = (p) => values[Math.min(values.length - 1, Math.floor(p * values.length))];
      return [
        k,
        { estimate: point[k], lower: q(0.025), upper: q(0.975), resamples: values.length },
      ];
    })
  );
}

function analyze(runDir) {
  const personas = JSON.parse(fs.readFileSync(path.join(runDir, 'per-profile.json'), 'utf8'));
  const language = personas.flatMap((p) => p.rows.language);
  const english = personas.flatMap((p) => p.rows.sentiment.filter((r) => r.truthLanguage === 'en'));
  const scored = english.filter((r) => r.predicted !== 'unscored');
  const counts = Object.fromEntries(
    SENTIMENT.map((l) => [l, scored.filter((r) => r.truth === l).length])
  );
  const majority = SENTIMENT.reduce((a, b) => (counts[a] >= counts[b] ? a : b));
  const shares = SENTIMENT.map((l) => counts[l] / scored.length);
  const bilingual = (p) => Object.keys(p.languageCounts).length > 1;
  const langAcc = (rows) => ({
    correct: rows.filter((r) => r.truth === r.predicted).length,
    n: rows.length,
    wilson: wilson(rows.filter((r) => r.truth === r.predicted).length, rows.length),
  });
  // Majority-topic baseline: give every English post (or like) the single most frequent
  // gold topic, and score it with the same pair-level precision and recall.
  const topicBaseline = (items) => {
    const freq = {};
    items.forEach((i) => i.topics.forEach((t) => (freq[t] = (freq[t] || 0) + 1)));
    const top = Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0];
    const gold = items.reduce((n, i) => n + i.topics.length, 0);
    const tp = items.filter((i) => i.topics.includes(top)).length;
    return { topic: top, precision: tp / items.length, recall: tp / gold };
  };
  const truths = personas.map((p) =>
    JSON.parse(fs.readFileSync(path.join(__dirname, 'profiles', `${p.id}.truth.json`), 'utf8'))
  );
  const englishTruth = truths.flatMap((t) => t.posts.filter((p) => p.language === 'en'));
  return {
    run: path.basename(runDir),
    note: 'Persona-level bootstrap: 10,000 resamples of whole personas with replacement, seed 20261007, percentile intervals. With ten clusters these intervals are approximate.',
    language: {
      overall: langAcc(language),
      monolingualPersonas: langAcc(
        personas.filter((p) => !bilingual(p)).flatMap((p) => p.rows.language)
      ),
      bilingualPersonas: langAcc(personas.filter(bilingual).flatMap((p) => p.rows.language)),
      byLanguage: Object.fromEntries(
        ['en', 'es', 'ur'].map((l) => [l, langAcc(language.filter((r) => r.truth === l))])
      ),
      baselineAlwaysEnglish: {
        accuracy: language.filter((r) => r.truth === 'en').length / language.length,
      },
    },
    sentiment: {
      construct:
        'Gold labels record the overall feeling the writer expresses or clearly implies about what they describe; VADER scores the wording.',
      labelCounts: counts,
      confusion: confusion(scored, SENTIMENT, SENTIMENT),
      accuracy: scored.filter((r) => r.truth === r.predicted).length / scored.length,
      macroF1: macroF1(scored, SENTIMENT),
      errors: scored.filter((r) => r.truth !== r.predicted).length,
      errorsPredictedNeutral: scored.filter(
        (r) => r.truth !== r.predicted && r.predicted === 'neutral'
      ).length,
      baselines: {
        majorityClass: {
          label: majority,
          accuracy: counts[majority] / scored.length,
          macroF1: macroF1(
            scored.map((r) => ({ ...r, predicted: majority })),
            SENTIMENT
          ),
        },
        stratifiedRandomExpected: {
          accuracy: shares.reduce((a, s) => a + s * s, 0),
          macroF1: shares.reduce((a, s) => a + s, 0) / SENTIMENT.length,
        },
      },
    },
    topicBaselines: {
      englishPosts: topicBaseline(englishTruth),
      likes: topicBaseline(truths.flatMap((t) => t.likes)),
    },
    perPersona: personas.map((p) => {
      const sc = p.rows.sentiment.filter(
        (r) => r.truthLanguage === 'en' && r.predicted !== 'unscored'
      );
      return {
        id: p.id,
        languages: p.languageCounts,
        languageAccuracy: ratio(
          p.rows.language.filter((r) => r.truth === r.predicted).length,
          p.rows.language.length
        ),
        sentimentScored: sc.length,
        sentimentAccuracy: ratio(sc.filter((r) => r.truth === r.predicted).length, sc.length),
        postTopics: { ...p.postTopics },
        likeTopics: { ...p.likeTopics },
        peakHours: { ...p.temporalPeak },
      };
    }),
    personaBootstrap: bootstrap(personas),
  };
}

if (require.main === module) {
  const resultsDir = path.join(__dirname, 'results');
  const run = process.argv[2] || fs.readFileSync(path.join(resultsDir, 'LATEST'), 'utf8').trim();
  const out = analyze(path.join(resultsDir, run));
  fs.writeFileSync(
    path.join(resultsDir, run, 'analysis.json'),
    JSON.stringify(out, null, 2) + '\n'
  );
  process.stdout.write(`${JSON.stringify(out.personaBootstrap, null, 2)}\n`);
}
module.exports = { analyze, macroF1, bootstrap, metrics };
