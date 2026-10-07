'use strict';
// Live-model evaluation of the verification layer. Runs the configured OpenAI model on the ten
// synthetic personas (only project-authored text is sent), records every request and response,
// and reports how the quote verifier, the deterministic sentence checks and the second-model
// judge treat real model output. Recorded responses are saved so that the analysis can be
// replayed without a key or network access.
//   Live:   node eval/run-live.js                 (needs OPENAI_API_KEY in .env or the shell)
//   Replay: node eval/run-live.js --replay <dir>  (dir is an earlier eval/live/<run> folder)
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runPipeline, hash } = require('../src/pipeline');
const { createModules } = require('../src/modules');
const { createFacebook } = require('../src/ingest/facebook');
const { liveProviders, promptMetadata } = require('../src/providers');
const { verifyInferences, normalize } = require('../src/analysis/inference');
const { numbers } = require('../src/report/explain');
const { explanationOutput } = require('../src/schemas');

const PERSONAS = ['p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07', 'p08', 'p09', 'p10'];
// Every model-backed option on, every other provider off: the run isolates the model path.
const consent = {
  openai: true,
  vision: false,
  hibp: false,
  localOcr: false,
  sensitive: true,
  personality: true,
};
const QUOTE_MIN_CHARS = [4, 8, 12, 20];
const QUOTE_MIN_WORDS = [1, 2, 3];

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const fixture = (id) => read(path.join(__dirname, 'profiles', `${id}.json`));
const truth = (id) => read(path.join(__dirname, 'profiles', `${id}.truth.json`));

function graphFor(profile) {
  return createFacebook({
    token: 'synthetic-offline-token',
    version: 'v24.0',
    fetchImpl: async (url) => {
      const endpoint = new URL(url).pathname.split('/').at(-1);
      const body =
        endpoint === 'me'
          ? { id: profile.id, name: profile.name, email: profile.email }
          : profile[endpoint];
      return { ok: true, status: 200, json: async () => structuredClone(body) };
    },
  });
}

// Captures the model snapshot and token usage that the provider itself does not return.
function captureOpenAiMetadata(meta) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const response = await original(url, options);
    if (String(url).startsWith('https://api.openai.com/') && response.ok) {
      const body = await response.clone().json();
      const request = JSON.parse(options.body);
      meta.set(request.messages[1].content, {
        model: body.model,
        systemFingerprint: body.system_fingerprint ?? null,
        usage: body.usage,
      });
    }
    return response;
  };
}

// Wraps generate so that each distinct (template, payload) is called once and recorded.
function recordingGenerate(base, calls, meta) {
  const byKey = new Map(calls.map((c) => [c.key, c]));
  return async (template, payload) => {
    const key = hash({ template, payload });
    let call = byKey.get(key);
    if (!call) {
      if (!base) throw new Error('replay_missing_response');
      call = { key, template, payload };
      try {
        call.response = await base(template, payload);
      } catch (err) {
        call.error = /^[a-z][a-z0-9_]{2,60}$/.test(err?.message || '') ? err.message : 'failed';
      }
      call.meta = meta.get(JSON.stringify(payload)) || null;
      calls.push(call);
      byKey.set(key, call);
    }
    if (call.error) throw new Error(call.error);
    return structuredClone(call.response);
  };
}

const words = (text) => text.trim().split(/\s+/).filter(Boolean).length;
const sameCity = (guess, city) => {
  const a = normalize(guess),
    b = normalize(city);
  return Boolean(a && b) && (a.includes(b) || b.includes(a));
};

function inferenceItems(call, posts, personaTruth) {
  const items = call?.response?.items || [];
  const verdict = verifyInferences(items, posts, true, true);
  const reasons = new Map(verdict.rejected.map((r) => [r.index, r.reason]));
  const accepted = new Set(verdict.accepted);
  return items.map((raw, index) => {
    const outcome =
      raw?.guess === null && !reasons.has(index)
        ? 'abstained'
        : accepted.has(raw)
          ? 'accepted'
          : reasons.has(index)
            ? `rejected:${reasons.get(index)}`
            : 'accepted';
    const evidence = (raw?.evidence || []).map((e) => ({
      postId: e.postId,
      quote: e.quote,
      postText: (() => {
        const p = posts.find((x) => x.id === e.postId);
        return p ? p.message || p.story || '' : null;
      })(),
      normalizedLength: normalize(e.quote || '').replace(/^["']+|["']+$/g, '').length,
      words: words(e.quote || ''),
    }));
    return {
      index,
      attribute: raw?.attribute,
      guess: raw?.guess ?? null,
      certainty: raw?.certainty ?? null,
      outcome,
      evidence,
      ...(raw?.attribute === 'location' && typeof raw.guess === 'string'
        ? { matchesPersonaCity: sameCity(raw.guess, personaTruth.city) }
        : {}),
    };
  });
}

// Re-checks every generated sentence with each verification layer on its own, so that the
// contribution of the deterministic checks and of the judge can be separated.
async function sentenceAblation(sentences, features, generate, source) {
  const out = [];
  for (const item of sentences) {
    const schemaOk = explanationOutput.safeParse({ sentences: [item] }).success;
    const keysOk =
      schemaOk &&
      item.supportedBy.every((k) => Object.hasOwn(features, k) && features[k].status === 'ok');
    let numbersOk = null,
      judge = null;
    if (keysOk) {
      const selected = Object.fromEntries(item.supportedBy.map((k) => [k, features[k]]));
      const allowed = Object.values(selected).flatMap((f) => [...numbers(f.value), f.n]);
      numbersOk = numbers(item.text).every((x) => allowed.some((v) => Math.abs(x - v) < 1e-9));
      try {
        judge =
          (await generate('judge', { sentence: item.text, features: selected })).supported === true;
      } catch {
        judge = false;
      }
    }
    out.push({
      source,
      text: item?.text ?? null,
      supportedBy: item?.supportedBy ?? [],
      schemaOk,
      keysOk,
      numbersOk,
      judge,
      deterministicPass: Boolean(keysOk && numbersOk),
      productionAccepted: Boolean(keysOk && numbersOk && judge),
    });
  }
  return out;
}

function tally(list, fn) {
  return list.reduce((n, x) => {
    const k = fn(x);
    n[k] = (n[k] || 0) + 1;
    return n;
  }, {});
}

async function main() {
  const replayIndex = process.argv.indexOf('--replay');
  const replayDir = replayIndex > -1 ? path.resolve(process.argv[replayIndex + 1]) : null;
  const calls = replayDir ? read(path.join(replayDir, 'calls.json')) : [];
  const meta = new Map();
  let base = null;
  if (!replayDir) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for a live run');
    captureOpenAiMetadata(meta);
    base = liveProviders(process.env).generate;
  }
  const generate = recordingGenerate(base, calls, meta);
  const providers = { generate };
  const personas = [];
  for (const id of PERSONAS) {
    const p = fixture(id),
      t = truth(id);
    const { report } = await runPipeline({
      owner: id,
      consent,
      ingest: () => graphFor(p).ingest(p.timezone, p.id),
      ...createModules(providers, p),
      context: { ...promptMetadata(process.env), mode: 'live_model_synthetic_personas' },
    });
    const posts = p.posts.data.filter((x) => x.message || x.story).slice(0, 200);
    const inferencePayload = {
      attributes: [
        'location',
        'occupation',
        'interests',
        'age_range',
        'relationship_status',
        'openness',
        'conscientiousness',
        'extraversion',
        'agreeableness',
      ],
      posts: posts.map((x) => ({ id: x.id, text: x.message || x.story })),
    };
    const inferenceCall = calls.find(
      (c) => c.key === hash({ template: 'inference', payload: inferencePayload })
    );
    const sectionSentences = [];
    for (const c of calls.filter(
      (x) => x.template.startsWith('explain-') && x.template !== 'explain-profile'
    ))
      if (Object.values(c.payload).some((f) => (f.inputs || []).some((s) => s.startsWith(id))))
        sectionSentences.push(...(c.response?.sentences || []));
    const profileCall = calls.find(
      (c) =>
        c.template === 'explain-profile' &&
        Object.values(c.payload).some((f) => (f.inputs || []).some((s) => s.startsWith(id)))
    );
    personas.push({
      id,
      inference: inferenceItems(inferenceCall, posts, t),
      inferenceError: inferenceCall?.error || null,
      explanations: await sentenceAblation(
        sectionSentences,
        report.features,
        generate,
        'section_explanation'
      ),
      summary: {
        status: report.explanations?.profile?.status || null,
        error: report.explanations?.profile?.error || null,
        accepted: (report.explanations?.profile?.sentences || []).map((s) => s.text),
        sentences: profileCall?.response?.sentences
          ? await sentenceAblation(
              profileCall.response.sentences,
              profileCall.payload,
              generate,
              'profile_summary'
            )
          : [],
      },
      productionExplanations: {
        attempted: report.explanations?.attempted ?? null,
        flagged: report.explanations?.flagged ?? null,
        accepted: (report.explanations?.sentences || []).length,
      },
    });
    process.stdout.write(`${id} done\n`);
  }

  const inference = personas.flatMap((p) => p.inference.map((i) => ({ persona: p.id, ...i })));
  const proposed = inference.filter((i) => i.outcome !== 'abstained');
  const accepted = inference.filter((i) => i.outcome === 'accepted');
  const quotes = accepted.flatMap((i) => i.evidence);
  const sentences = personas.flatMap((p) => [...p.explanations, ...p.summary.sentences]);
  const layer = (list) => ({
    generated: list.length,
    schemaValid: list.filter((s) => s.schemaOk).length,
    keysValid: list.filter((s) => s.keysOk).length,
    passNumbers: list.filter((s) => s.keysOk && s.numbersOk).length,
    passJudgeAlone: list.filter((s) => s.keysOk && s.judge).length,
    passDeterministic: list.filter((s) => s.deterministicPass).length,
    passBoth: list.filter((s) => s.productionAccepted).length,
    rejectedByNumbersOnly: list.filter((s) => s.keysOk && !s.numbersOk && s.judge).length,
    rejectedByJudgeOnly: list.filter((s) => s.keysOk && s.numbersOk && !s.judge).length,
  });
  const usage = calls.reduce(
    (n, c) => ({
      prompt: n.prompt + (c.meta?.usage?.prompt_tokens || 0),
      completion: n.completion + (c.meta?.usage?.completion_tokens || 0),
    }),
    { prompt: 0, completion: 0 }
  );
  let gitRevision = 'unavailable';
  try {
    gitRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    /* optional */
  }
  const summary = {
    runId: replayDir ? path.basename(replayDir) : new Date().toISOString().replace(/[:.]/g, '-'),
    mode: replayDir ? 'replay_of_recorded_responses' : 'live_model',
    consent,
    model: {
      requested: promptMetadata(process.env).model,
      returnedSnapshots: [...new Set(calls.map((c) => c.meta?.model).filter(Boolean))],
      systemFingerprints: [...new Set(calls.map((c) => c.meta?.systemFingerprint).filter(Boolean))],
      temperature: 0,
    },
    promptVersion: promptMetadata(process.env).promptVersion,
    promptHashes: promptMetadata(process.env).promptHashes,
    gitRevision,
    calls: { total: calls.length, failed: calls.filter((c) => c.error).length },
    tokens: usage,
    inference: {
      itemsReturned: inference.length,
      abstained: inference.filter((i) => i.outcome === 'abstained').length,
      proposed: proposed.length,
      accepted: accepted.length,
      outcomes: tally(inference, (i) => i.outcome),
      byAttribute: Object.fromEntries(
        [...new Set(inference.map((i) => i.attribute))].map((a) => [
          a,
          tally(
            inference.filter((i) => i.attribute === a),
            (i) => i.outcome
          ),
        ])
      ),
      location: {
        accepted: accepted.filter((i) => i.attribute === 'location').length,
        acceptedMatchingCity: accepted.filter(
          (i) => i.attribute === 'location' && i.matchesPersonaCity
        ).length,
        personasWithoutAcceptedLocation: personas
          .filter(
            (p) => !p.inference.some((i) => i.attribute === 'location' && i.outcome === 'accepted')
          )
          .map((p) => p.id),
      },
      acceptedQuoteLengths: {
        quotes: quotes.length,
        normalizedCharacters: quotes.map((q) => q.normalizedLength).sort((a, b) => a - b),
        wouldBeRejectedAtMinimumCharacters: Object.fromEntries(
          QUOTE_MIN_CHARS.map((m) => [
            m,
            accepted.filter((i) => i.evidence.some((e) => e.normalizedLength < m)).length,
          ])
        ),
        wouldBeRejectedAtMinimumWords: Object.fromEntries(
          QUOTE_MIN_WORDS.map((m) => [
            m,
            accepted.filter((i) => i.evidence.some((e) => e.words < m)).length,
          ])
        ),
      },
    },
    sentences: {
      sectionExplanations: layer(sentences.filter((s) => s.source === 'section_explanation')),
      profileSummaries: layer(sentences.filter((s) => s.source === 'profile_summary')),
      summaryStatus: tally(personas, (p) => p.summary.status || 'none'),
    },
    limitations: [
      'Synthetic personas written by the author; not natural data.',
      'Verifier outcomes are reported here; whether accepted output is supported or true needs the human ratings in eval/annotation.',
      'The judge is a second call to the same model, not an independent validator.',
      'A model alias can point to different snapshots over time; returnedSnapshots records what answered this run.',
    ],
  };
  const outDir = replayDir || path.join(__dirname, 'live', summary.runId);
  fs.mkdirSync(outDir, { recursive: true });
  if (!replayDir)
    fs.writeFileSync(path.join(outDir, 'calls.json'), JSON.stringify(calls, null, 2) + '\n');
  const suffix = replayDir ? '.replay' : '';
  fs.writeFileSync(path.join(outDir, `items${suffix}.json`), JSON.stringify(personas, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, `summary${suffix}.json`), JSON.stringify(summary, null, 2) + '\n');
  process.stdout.write(`${outDir}\n`);
}

if (require.main === module)
  main().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  });
