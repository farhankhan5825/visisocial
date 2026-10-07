'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { execFileSync } = require('node:child_process');
const { runPipeline } = require('../src/pipeline');
const { createModules } = require('../src/modules');
const { createFacebook } = require('../src/ingest/facebook');
const { promptMetadata } = require('../src/providers');
const { Cache } = require('../src/privacy/cache');
const { mockProviders } = require('./mock-providers');
const {
  precisionRecall,
  ocrError,
  distribution,
  wilson,
  classification,
  pooled,
} = require('./metrics');
const consent = { openai: true, vision: true, hibp: true, localOcr: false, sensitive: false };
function fixture(id) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'profiles', `${id}.json`), 'utf8'));
}
function mockGraph(profile) {
  return createFacebook({
    token: 'synthetic-offline-token',
    version: 'v24.0',
    fetchImpl: async (url) => {
      const endpoint = new URL(url).pathname.split('/').at(-1);
      const response =
        endpoint === 'me'
          ? { id: profile.id, name: profile.name, email: profile.email }
          : profile[endpoint];
      return { ok: true, status: 200, json: async () => structuredClone(response) };
    },
  });
}
async function execute(id, cache = new Cache(), failModule) {
  const p = fixture(id),
    graph = mockGraph(p);
  return runPipeline({
    owner: id,
    cache,
    consent,
    ingest: () => graph.ingest(p.timezone, p.id),
    ...createModules(mockProviders(id), p),
    context: {
      ...promptMetadata(),
      mode: 'authored_mock_providers',
      graphVersion: 'offline_mock_v24.0_shape',
    },
    failModule,
  });
}
const SENTIMENT_LABELS = ['positive', 'neutral', 'negative', 'unscored'];
// Rule-based modules are scored against the hand annotations in fixtures-source.js.
// Provider-backed modules (vision, inference, breaches, explanations) run on authored
// doubles, so they are reported as contract checks, never as accuracy.
function assess(report, truth) {
  const f = report.features,
    images = f['image.observations']?.value || [];
  const languages = new Map((f['text.languages']?.value?.perPost || []).map((l) => [l.postId, l]));
  const sentiments = new Map((f['text.sentiment']?.value?.posts || []).map((p) => [p.postId, p]));
  const predictedTopics = new Map();
  (f['text.topics']?.value || []).forEach((t) =>
    t.postIds.forEach((id) =>
      predictedTopics.set(id, [...(predictedTopics.get(id) || []), t.topic])
    )
  );
  const englishPosts = truth.posts.filter((p) => p.language === 'en');
  const pairs = (posts, map) => posts.flatMap((p) => (map(p) || []).map((t) => `${p.postId}:${t}`));
  const likeTopics = new Map();
  (f['interests.categories']?.value || []).forEach((c) =>
    c.likeIds.forEach((id) => likeTopics.set(id, [...(likeTopics.get(id) || []), c.topic]))
  );
  return {
    rows: {
      language: truth.posts.map((p) => ({
        postId: p.postId,
        truth: p.language,
        predicted: languages.get(p.postId)?.language ?? null,
        source: languages.get(p.postId)?.source ?? null,
      })),
      sentiment: truth.posts.map((p) => ({
        postId: p.postId,
        truthLanguage: p.language,
        truth: p.sentiment,
        predicted: sentiments.get(p.postId)?.label ?? 'unscored',
      })),
    },
    postTopics: precisionRecall(
      pairs(englishPosts, (p) => predictedTopics.get(p.postId)),
      pairs(englishPosts, (p) => p.topics)
    ),
    postTopicsAllLanguages: precisionRecall(
      pairs(truth.posts, (p) => predictedTopics.get(p.postId)),
      pairs(truth.posts, (p) => p.topics)
    ),
    profileTopics: precisionRecall(
      (f['text.topics']?.value || []).filter((t) => t.count >= 2).map((t) => t.topic),
      truth.topics
    ),
    likeTopics: precisionRecall(
      truth.likes.flatMap((l) => (likeTopics.get(l.likeId) || []).map((t) => `${l.likeId}:${t}`)),
      truth.likes.flatMap((l) => l.topics.map((t) => `${l.likeId}:${t}`))
    ),
    temporalPeak: precisionRecall(f['temporal.peakHours']?.value || [], truth.peakHours),
    contracts: {
      visionLabels: precisionRecall(
        images.flatMap((p) => p.labels.map((l) => `${p.photoId}:${l.label}`)),
        truth.photoTruth.flatMap((p) => p.labels.map((l) => `${p.photoId}:${l}`))
      ),
      ocr: ocrError(
        images.map((p) => p.text).join('\n'),
        truth.photoTruth.map((p) => p.text).join('\n')
      ),
      inferenceAttributes: precisionRecall(
        (f['inference.guesses']?.value || []).map((g) => `${g.attribute}:${g.guess}`),
        truth.inference
      ),
      breaches: precisionRecall(
        (f['osint.breaches']?.value || []).map((b) => b.name),
        truth.breaches.map((b) => b.Name)
      ),
      explanation: {
        attempted: report.explanations.attempted,
        flagged: report.explanations.flagged,
      },
      inferenceEvidence: report.modules.inference.diagnostics,
    },
  };
}
function summarizeAccuracy(perProfile) {
  const all = (key) => perProfile.flatMap((p) => p.rows[key]);
  const languageRows = all('language').map((r) => ({
    truth: r.truth,
    predicted: ['en', 'es', 'ur'].includes(r.predicted) ? r.predicted : 'other_or_none',
  }));
  const sentimentRows = all('sentiment');
  const englishSentiment = sentimentRows.filter((r) => r.truthLanguage === 'en');
  const scoredEnglish = englishSentiment.filter((r) => r.predicted !== 'unscored');
  const byLanguage = Object.fromEntries(
    ['en', 'es', 'ur'].map((language) => {
      const rows = sentimentRows.filter((r) => r.truthLanguage === language);
      return [
        language,
        {
          posts: rows.length,
          sentimentScored: wilson(
            rows.filter((r) => r.predicted !== 'unscored').length,
            rows.length
          ),
          // Topic rules are English-only, so their recall here is 0 by design whenever
          // posts are correctly detected as Spanish or Urdu.
          inTopicCoverage: rows.filter((r) => r.predicted !== 'unscored').length,
        },
      ];
    })
  );
  return {
    annotation:
      'Single annotator (the implementer) labelled each post while writing it; see eval/README.md.',
    language: {
      ...classification(languageRows, ['en', 'es', 'ur', 'other_or_none']),
      inheritedFromProfile: all('language').filter((r) => r.source === 'profile_dominant_language')
        .length,
    },
    sentimentEnglish: {
      englishPosts: englishSentiment.length,
      coverage: wilson(scoredEnglish.length, englishSentiment.length),
      onScoredPosts: classification(
        scoredEnglish.map((r) => ({ truth: r.truth, predicted: r.predicted })),
        SENTIMENT_LABELS.slice(0, 3)
      ),
      endToEnd: classification(
        englishSentiment.map((r) => ({ truth: r.truth, predicted: r.predicted })),
        SENTIMENT_LABELS
      ),
    },
    sentimentNonEnglishScored: sentimentRows.filter(
      (r) => r.truthLanguage !== 'en' && r.predicted !== 'unscored'
    ).length,
    postTopicsEnglish: pooled(perProfile.map((p) => p.postTopics)),
    postTopicsAllLanguages: pooled(perProfile.map((p) => p.postTopicsAllLanguages)),
    profileTopics: pooled(perProfile.map((p) => p.profileTopics)),
    likeTopics: pooled(perProfile.map((p) => p.likeTopics)),
    temporalPeak: pooled(perProfile.map((p) => p.temporalPeak)),
    languageCoverage: byLanguage,
  };
}
async function run() {
  const runId = new Date().toISOString().replace(/[:.]/g, '-'),
    dir = path.join(__dirname, 'results', runId);
  fs.mkdirSync(dir, { recursive: true });
  const rows = [],
    perProfile = [];
  let flagged = 0,
    attempted = 0,
    rejected = 0,
    inferenceAttempts = 0;
  for (let i = 1; i <= 10; i++) {
    const id = `p${String(i).padStart(2, '0')}`,
      truth = JSON.parse(
        fs.readFileSync(path.join(__dirname, 'profiles', `${id}.truth.json`), 'utf8')
      );
    const result = await execute(id),
      metrics = assess(result.report, truth);
    perProfile.push({
      id,
      timezone: truth.timezone,
      languageCounts: truth.languageCounts,
      ...metrics,
    });
    flagged += metrics.contracts.explanation.flagged;
    attempted += metrics.contracts.explanation.attempted;
    rejected += metrics.contracts.inferenceEvidence.rejected;
    inferenceAttempts += metrics.contracts.inferenceEvidence.attempted;
    fs.writeFileSync(path.join(dir, `${id}.report.json`), JSON.stringify(result.report, null, 2));
  }
  for (const mode of ['cold', 'warm']) {
    const cache = new Cache();
    if (mode === 'warm')
      for (let i = 1; i <= 10; i++) await execute(`p${String(i).padStart(2, '0')}`, cache);
    for (let run = 0; run < 30; run++) {
      const id = `p${String((run % 10) + 1).padStart(2, '0')}`,
        start = performance.now();
      const result = await execute(id, mode === 'cold' ? new Cache() : cache);
      const total = performance.now() - start;
      rows.push({
        mode,
        run: run + 1,
        profile: id,
        total,
        ...result.timings,
        cacheHitCount: Object.values(result.cacheHits).filter(Boolean).length,
      });
    }
  }
  const totals = (key) => {
    const list = perProfile.map((p) => p.contracts[key]),
      tp = list.reduce((n, r) => n + r.tp, 0),
      fp = list.reduce((n, r) => n + r.fp, 0),
      fn = list.reduce((n, r) => n + r.fn, 0);
    return {
      tp,
      fp,
      fn,
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
    };
  };
  const injected = await execute('p01', new Cache(), 'image');
  const failureIsolation = {
    injectedModule: 'image',
    failed: injected.report.modules.image.status === 'failed',
    otherModules: Object.fromEntries(
      Object.entries(injected.report.modules)
        .filter(([k]) => k !== 'image')
        .map(([k, v]) => [k, v.status])
    ),
    reportGenerated: Boolean(injected.report.features['text.topics']),
    explanationsGenerated: injected.report.explanations.sentences.length > 0,
  };
  fs.writeFileSync(
    path.join(dir, 'failure-injection.report.json'),
    JSON.stringify(injected.report, null, 2)
  );
  const stages = [
    'total',
    'ingest',
    'text',
    'temporal',
    'interests',
    'image',
    'inference',
    'osint',
    'synthesis',
    'explanation',
  ];
  const timing = Object.fromEntries(
    ['cold', 'warm'].map((mode) => [
      mode,
      Object.fromEntries(
        stages.map((stage) => [
          stage,
          distribution(rows.filter((r) => r.mode === mode).map((r) => r[stage])),
        ])
      ),
    ])
  );
  const ocrSum = (field) => perProfile.reduce((n, p) => n + p.contracts.ocr[field], 0);
  const characterEdits = ocrSum('characterEdits'),
    characters = ocrSum('characters'),
    wordEdits = ocrSum('wordEdits'),
    words = ocrSum('words');
  let gitRevision = 'unavailable',
    gitDirty = null;
  try {
    gitRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    // Uncommitted changes outside saved results mean the run is not reproducible from the
    // recorded commit alone; the source hashes below still identify the code.
    gitDirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
      .split('\n')
      .some((line) => line.trim() && !/ eval\/(results|live)\//.test(line));
  } catch {
    /* Not required for an exported source archive. */
  }
  function sourceFiles(directory) {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .flatMap((e) =>
        e.isDirectory()
          ? sourceFiles(path.join(directory, e.name))
          : ['.js', '.md'].includes(path.extname(e.name))
            ? [path.join(directory, e.name)]
            : []
      );
  }
  const codePaths = [
    ...sourceFiles(path.join(__dirname, '../src')),
    ...sourceFiles(__dirname).filter(
      (p) =>
        !p.includes(`${path.sep}results${path.sep}`) && !p.includes(`${path.sep}live${path.sep}`)
    ),
  ].sort();
  const sourceHashes = Object.fromEntries(
    codePaths.map((p) => [
      path.relative(path.join(__dirname, '..'), p).replaceAll(path.sep, '/'),
      require('../src/pipeline').hash(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')),
    ])
  );
  const summary = {
    runId,
    protocolVersion: '2.0.0',
    providerMode: 'authored_synthetic_mocks_no_network',
    limitations: [
      'accuracy: rule-based modules (language, sentiment, topics, like categories, peak hour) against single-annotator labels on 200 project-authored posts and 80 likes. Not a validated benchmark; no inter-annotator agreement.',
      'contracts: vision, inference, breach and explanation rows use authored provider doubles with planted errors. They show the verification and rejection paths work, not provider accuracy.',
      'Cold means empty in-process module cache, not fresh process or hardware cold start.',
      'Warm is prefilled per-owner module cache; Graph ingestion, synthesis and explanation still run.',
      '30 repeated runs per condition are not 30 independent profiles.',
      'No OAuth, network latency, rendering or provider service latency is timed.',
    ],
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      cpu: os.cpus()[0]?.model,
      gitRevision,
      gitDirty,
      sourceHashProcedure:
        'SHA-256 of JSON.stringify(file text with CRLF converted to LF), via src/pipeline.js hash()',
      sourceHashes,
      lockfileHash: require('../src/pipeline').hash(
        fs.readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8').replace(/\r\n/g, '\n')
      ),
    },
    profiles: 10,
    timedRuns: 60,
    repeatsPerProfilePerCondition: 3,
    accuracy: summarizeAccuracy(perProfile),
    contracts: Object.fromEntries(
      ['visionLabels', 'inferenceAttributes', 'breaches'].map((key) => [key, totals(key)])
    ),
    ocr: {
      characterEdits,
      characters,
      CER: characterEdits / characters,
      wordEdits,
      words,
      WER: wordEdits / words,
    },
    explanation: {
      attempted,
      flagged,
      flaggedRate: flagged / attempted,
      acceptedRate: (attempted - flagged) / attempted,
      judgeMode: 'authored_mock_judge',
    },
    inference: {
      attempted: inferenceAttempts,
      rejected,
      evidenceRejectionRate: rejected / inferenceAttempts,
    },
    failureIsolation,
    timing,
  };
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(dir, 'per-profile.json'), JSON.stringify(perProfile, null, 2));
  const columns = ['mode', 'run', 'profile', ...stages, 'cacheHitCount'];
  fs.writeFileSync(
    path.join(dir, 'timings.csv'),
    columns.join(',') +
      '\n' +
      rows.map((row) => columns.map((c) => row[c]).join(',')).join('\n') +
      '\n'
  );
  fs.writeFileSync(path.join(__dirname, 'results', 'LATEST'), runId + '\n');
  process.stdout.write(
    JSON.stringify(
      {
        runId,
        timedRuns: summary.timedRuns,
        providerMode: summary.providerMode,
        accuracy: summary.accuracy,
        contracts: summary.contracts,
        explanation: summary.explanation,
        inference: summary.inference,
        failureIsolation,
        timing: { cold: timing.cold.total, warm: timing.warm.total },
      },
      null,
      2
    ) + '\n'
  );
  if (
    !failureIsolation.failed ||
    Object.values(failureIsolation.otherModules).some((s) => s !== 'ok')
  )
    throw new Error('failure_isolation_failed');
  return summary;
}
if (require.main === module)
  run().catch((error) => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
module.exports = { run, execute, assess, mockGraph };
