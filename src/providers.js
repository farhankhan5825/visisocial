'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { downloadPhoto } = require('./privacy/network');
const { providerSchema } = require('./schemas/provider-json');
// Default model alias. Dated snapshots are retired over time (gpt-4o-mini-2024-07-18 returned
// 404 for a current key), so OPENAI_MODEL may pin another model; reports record which one.
const MODEL = 'gpt-4o-mini';
function modelName(env = process.env) {
  const m = env.OPENAI_MODEL || MODEL;
  if (!/^[a-z0-9][a-z0-9.:-]{1,80}$/.test(m)) throw new Error('invalid_openai_model');
  return m;
}
function promptMetadata(env = process.env) {
  const directory = path.join(__dirname, 'prompts');
  return {
    model: modelName(env),
    temperature: 0,
    promptVersion: '1.2.0',
    promptHashes: Object.fromEntries(
      fs
        .readdirSync(directory)
        .filter((f) => f.endsWith('.md'))
        .map((f) => [
          f.slice(0, -3),
          createHash('sha256')
            .update(
              fs
                .readFileSync(path.join(directory, f), 'utf8')
                .replace(/\r\n/g, '\n')
                .replace(/^\uFEFF/, '')
            )
            .digest('hex'),
        ])
    ),
  };
}
function liveProviders(env = process.env) {
  const generate = env.OPENAI_API_KEY
    ? async (template, payload) => {
        if (
          !/^(inference|judge|explain-(profile|text|temporal|image|interests|inference|osint))$/.test(
            template
          )
        )
          throw new Error('invalid_template');
        const instructions = fs.readFileSync(
          path.join(__dirname, 'prompts', `${template}.md`),
          'utf8'
        );
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelName(env),
            temperature: 0,
            store: false,
            response_format: providerSchema(template, payload),
            messages: [
              { role: 'system', content: instructions },
              { role: 'user', content: JSON.stringify(payload) },
            ],
            max_tokens: 2000,
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(60000),
        });
        // Status only (401 bad key, 404 unknown model, 429 quota); never the response text.
        if (!response.ok) throw new Error(`llm_http_${response.status}`);
        const body = await response.json();
        return JSON.parse(body.choices[0].message.content);
      }
    : undefined;
  let client;
  const annotate = env.GOOGLE_APPLICATION_CREDENTIALS
    ? async (photo, features) => {
        client ||= new (require('@google-cloud/vision').ImageAnnotatorClient)();
        const bytes = await downloadPhoto(photo.images?.[0]?.source || photo.picture);
        const [response] = await client.annotateImage({
          image: { content: bytes },
          features: features.map((type) => ({ type })),
        });
        return response;
      }
    : undefined;
  const fallback = env.TESSERACT_LANG_PATH
    ? async (photo) => {
        const { createWorker } = require('tesseract.js');
        const bytes = await downloadPhoto(photo.images?.[0]?.source || photo.picture);
        const worker = await createWorker('eng', 1, {
          langPath: env.TESSERACT_LANG_PATH,
          cacheMethod: 'none',
          gzip: false,
        });
        try {
          const result = await worker.recognize(bytes);
          return result.data;
        } finally {
          await worker.terminate();
        }
      }
    : undefined;
  const checkBreaches = env.HIBP_API_KEY
    ? async (email) => {
        const url = `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`;
        for (let attempt = 0; attempt < 3; attempt++) {
          const r = await fetch(url, {
            headers: {
              'hibp-api-key': env.HIBP_API_KEY,
              'user-agent': 'VisiSocial/3.0 (owned-email transparency research)',
            },
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
          });
          if (r.status === 404) return [];
          if (r.status === 429 && attempt < 2) {
            const seconds = Number(r.headers.get('retry-after'));
            if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60)
              throw new Error('hibp_retry_later');
            await new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 100));
            continue;
          }
          if (r.status === 401) throw new Error('hibp_key_rejected');
          if (!r.ok) throw new Error(`hibp_http_${r.status}`);
          return r.json();
        }
      }
    : undefined;
  return { generate, annotate, fallback, checkBreaches };
}
module.exports = { liveProviders, promptMetadata, modelName, MODEL };
