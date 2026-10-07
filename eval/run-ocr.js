'use strict';
// A separate genuine local OCR run. Never conflated with authored Vision responses.
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createWorker } = require('tesseract.js');
const { ocrError, distribution } = require('./metrics');
async function run() {
  const langPath = process.env.TESSERACT_LANG_PATH || path.join(__dirname, '..');
  if (!fs.existsSync(path.join(langPath, 'eng.traineddata')))
    throw new Error('Download public eng.traineddata and set TESSERACT_LANG_PATH; see README.');
  const runId = `ocr-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    directory = path.join(__dirname, 'results', runId);
  fs.mkdirSync(directory, { recursive: true });
  const worker = await createWorker('eng', 1, { langPath, gzip: false, cacheMethod: 'none' }),
    observations = [];
  try {
    for (let i = 1; i <= 10; i++) {
      const id = `p${String(i).padStart(2, '0')}`,
        truth = JSON.parse(fs.readFileSync(path.join(__dirname, 'profiles', `${id}.truth.json`)));
      for (const photo of truth.photoTruth) {
        const start = performance.now(),
          result = await worker.recognize(path.join(__dirname, 'profiles', `${photo.photoId}.png`)),
          durationMs = performance.now() - start;
        const text = result.data.text.trim();
        observations.push({
          id: photo.photoId,
          truth: photo.text,
          predicted: text,
          confidence: result.data.confidence,
          durationMs,
          ...ocrError(text, photo.text),
        });
      }
    }
  } finally {
    await worker.terminate();
  }
  const sum = (field) => observations.reduce((n, p) => n + p[field], 0),
    summary = {
      runId,
      provider: 'tesseract_local_real_execution',
      language: 'eng',
      version: require('tesseract.js/package.json').version,
      trainedDataSHA256: require('node:crypto')
        .createHash('sha256')
        .update(fs.readFileSync(path.join(langPath, 'eng.traineddata')))
        .digest('hex'),
      n: observations.length,
      characterEdits: sum('characterEdits'),
      characters: sum('characters'),
      CER: sum('characterEdits') / sum('characters'),
      wordEdits: sum('wordEdits'),
      words: sum('words'),
      WER: sum('wordEdits') / sum('words'),
      timings: distribution(observations.map((p) => p.durationMs)),
      limitations: [
        'Simple repeated English text on project-drawn synthetic images, not natural photos.',
        'Shared worker; per-image time excludes worker initialization and language loading.',
        'No evidence about Google Vision performance or non-English OCR.',
      ],
    };
  fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(
    path.join(directory, 'observations.json'),
    JSON.stringify(observations, null, 2)
  );
  fs.writeFileSync(path.join(__dirname, 'results', 'LATEST_OCR'), runId + '\n');
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}
if (require.main === module)
  run().catch((e) => {
    process.stderr.write(e.message + '\n');
    process.exitCode = 1;
  });
module.exports = { run };
