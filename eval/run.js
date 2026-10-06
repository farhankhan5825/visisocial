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
const { precisionRecall, ocrError, distribution } = require('./metrics');
const consent = { openai: true, vision: true, hibp: true, localOcr: false, sensitive: false };
function fixture(id) { return JSON.parse(fs.readFileSync(path.join(__dirname, 'profiles', `${id}.json`), 'utf8')); }
function mockGraph(profile) {
  return createFacebook({ token: 'synthetic-offline-token', version: 'v24.0', fetchImpl: async url => {
    const endpoint = new URL(url).pathname.split('/').at(-1);
    const response = endpoint === 'me' ? { id: profile.id, name: profile.name, email: profile.email } : profile[endpoint];
    return { ok: true, status: 200, json: async () => structuredClone(response) };
  } });
}
async function execute(id, cache = new Cache(), failModule) {
  const p = fixture(id), graph = mockGraph(p);
  return runPipeline({ owner: id, cache, consent, ingest: () => graph.ingest(p.timezone, p.id), ...createModules(mockProviders(id), p), context: { ...promptMetadata(), mode: 'authored_mock_providers', graphVersion: 'offline_mock_v24.0_shape' }, failModule });
}
function assess(report, truth) {
  const f = report.features, images = f['image.observations']?.value || [];
  const text = images.map(p => p.text).join('\n'), groundText = truth.photoTruth.map(p => p.text).join('\n');
  return { topics: precisionRecall((f['text.topics']?.value || []).map(t => t.topic), truth.topics), temporalPeak: precisionRecall(f['temporal.peakHours']?.value || [], truth.peakHours), visionLabels: precisionRecall(images.flatMap(p => p.labels.map(l => `${p.photoId}:${l.label}`)), truth.photoTruth.flatMap(p => p.labels.map(l => `${p.photoId}:${l}`))), inferenceAttributes: precisionRecall((f['inference.guesses']?.value || []).map(g => `${g.attribute}:${g.guess}`), truth.inference), interests: precisionRecall((f['interests.categories']?.value || []).map(t => t.topic), truth.interests), breaches: precisionRecall((f['osint.breaches']?.value || []).map(b => b.name), truth.breaches.map(b => b.Name)), ocr: ocrError(text, groundText), sentimentDistribution: { predicted: f['text.sentiment'].value.distribution, truth: truth.sentiment }, explanation: { attempted: report.explanations.attempted, flagged: report.explanations.flagged, flaggedRate: report.explanations.flaggedRate }, inferenceEvidence: report.modules.inference.diagnostics };
}
async function run() {
  const runId = new Date().toISOString().replace(/[:.]/g, '-'), dir = path.join(__dirname, 'results', runId); fs.mkdirSync(dir, { recursive: true });
  const rows = [], perProfile = []; let flagged = 0, attempted = 0, rejected = 0, inferenceAttempts = 0;
  for (let i = 1; i <= 10; i++) {
    const id = `p${String(i).padStart(2, '0')}`, truth = JSON.parse(fs.readFileSync(path.join(__dirname, 'profiles', `${id}.truth.json`), 'utf8'));
    const result = await execute(id), metrics = assess(result.report, truth);
    perProfile.push({ id, language: truth.language, ...metrics }); flagged += metrics.explanation.flagged; attempted += metrics.explanation.attempted; rejected += metrics.inferenceEvidence.rejected; inferenceAttempts += metrics.inferenceEvidence.attempted;
    fs.writeFileSync(path.join(dir, `${id}.report.json`), JSON.stringify(result.report, null, 2));
  }
  for (const mode of ['cold', 'warm']) {
    const cache = new Cache();
    if (mode === 'warm') for (let i = 1; i <= 10; i++) await execute(`p${String(i).padStart(2, '0')}`, cache);
    for (let run = 0; run < 30; run++) {
      const id = `p${String(run % 10 + 1).padStart(2, '0')}`, start = performance.now();
      const result = await execute(id, mode === 'cold' ? new Cache() : cache);
      const total = performance.now() - start;
      rows.push({ mode, run: run + 1, profile: id, total, ...result.timings, cacheHitCount: Object.values(result.cacheHits).filter(Boolean).length });
    }
  }
  const totals = key => { const list = perProfile.map(p => p[key]), tp = list.reduce((n, r) => n + r.tp, 0), fp = list.reduce((n, r) => n + r.fp, 0), fn = list.reduce((n, r) => n + r.fn, 0); return { tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null }; };
  const injected = await execute('p01', new Cache(), 'image');
  const failureIsolation = { injectedModule: 'image', failed: injected.report.modules.image.status === 'failed', otherModules: Object.fromEntries(Object.entries(injected.report.modules).filter(([k]) => k !== 'image').map(([k, v]) => [k, v.status])), reportGenerated: Boolean(injected.report.features['text.topics']), explanationsGenerated: injected.report.explanations.sentences.length > 0 };
  fs.writeFileSync(path.join(dir, 'failure-injection.report.json'), JSON.stringify(injected.report, null, 2));
  const stages = ['total', 'ingest', 'text', 'temporal', 'interests', 'image', 'inference', 'osint', 'synthesis', 'explanation'];
  const timing = Object.fromEntries(['cold', 'warm'].map(mode => [mode, Object.fromEntries(stages.map(stage => [stage, distribution(rows.filter(r => r.mode === mode).map(r => r[stage]))]))]));
  const characterEdits = perProfile.reduce((n, p) => n + p.ocr.characterEdits, 0), characters = perProfile.reduce((n, p) => n + p.ocr.characters, 0), wordEdits = perProfile.reduce((n, p) => n + p.ocr.wordEdits, 0), words = perProfile.reduce((n, p) => n + p.ocr.words, 0);
  let gitRevision = 'unavailable'; try { gitRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* Not required for an exported source archive. */ }
  function sourceFiles(directory) { return fs.readdirSync(directory, { withFileTypes: true }).flatMap(e => e.isDirectory() ? sourceFiles(path.join(directory, e.name)) : ['.js', '.md'].includes(path.extname(e.name)) ? [path.join(directory, e.name)] : []); }
  const codePaths = [...sourceFiles(path.join(__dirname, '../src')), ...sourceFiles(__dirname).filter(p => !p.includes(`${path.sep}results${path.sep}`))].sort();
  const sourceHashes = Object.fromEntries(codePaths.map(p => [path.relative(path.join(__dirname, '..'), p).replaceAll(path.sep, '/'), require('../src/pipeline').hash(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'))]));
  const summary = { runId, protocolVersion: '1.0.0', providerMode: 'authored_synthetic_mocks_no_network', limitations: ['Mock agreement measures software contract handling, not live model/API accuracy.', 'Cold means empty in-process module cache, not fresh process or hardware cold start.', 'Warm is prefilled per-owner module cache; Graph ingestion, synthesis and explanation still run.', '30 repeated runs per condition are not 30 independent profiles.', 'No OAuth, network latency, rendering or provider service latency is timed.', 'Cross-language topic divergence is a limitation of English rules. This is a coverage pilot, not demographic fairness evidence.'], environment: { node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model, gitRevision, sourceHashes, lockfileHash: require('../src/pipeline').hash(fs.readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8').replace(/\r\n/g, '\n')) }, profiles: 10, timedRuns: 60, repeatsPerProfilePerCondition: 3, aggregate: Object.fromEntries(['topics', 'temporalPeak', 'visionLabels', 'inferenceAttributes', 'interests', 'breaches'].map(key => [key, totals(key)])), ocr: { characterEdits, characters, CER: characterEdits / characters, wordEdits, words, WER: wordEdits / words }, explanation: { attempted, flagged, flaggedRate: flagged / attempted, acceptedRate: (attempted - flagged) / attempted, judgeMode: 'authored_mock_judge' }, inference: { attempted: inferenceAttempts, rejected, evidenceRejectionRate: rejected / inferenceAttempts }, failureIsolation, timing, biasPilot: Object.fromEntries(['en', 'es', 'ur'].map(language => { const group = perProfile.filter(p => p.language === language); return [language, { n: group.length, topicRecall: group.reduce((n, p) => n + p.topics.recall, 0) / group.length, sentimentUnscoredFraction: group.reduce((n, p) => n + p.sentimentDistribution.predicted.unscored / 20, 0) / group.length }]; })) };
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2)); fs.writeFileSync(path.join(dir, 'per-profile.json'), JSON.stringify(perProfile, null, 2));
  const columns = ['mode', 'run', 'profile', ...stages, 'cacheHitCount']; fs.writeFileSync(path.join(dir, 'timings.csv'), columns.join(',') + '\n' + rows.map(row => columns.map(c => row[c]).join(',')).join('\n') + '\n');
  fs.writeFileSync(path.join(__dirname, 'results', 'LATEST'), runId + '\n');
  process.stdout.write(JSON.stringify({ runId, timedRuns: summary.timedRuns, providerMode: summary.providerMode, aggregate: summary.aggregate, explanation: summary.explanation, inference: summary.inference, failureIsolation, timing: { cold: timing.cold.total, warm: timing.warm.total } }, null, 2) + '\n');
  if (!failureIsolation.failed || Object.values(failureIsolation.otherModules).some(s => s !== 'ok')) throw new Error('failure_isolation_failed');
  return summary;
}
if (require.main === module) run().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
module.exports = { run, execute, assess, mockGraph };
