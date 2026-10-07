'use strict';
// Scores completed annotation sheets.
//   Task A: node eval/annotation/agreement.js <suffix>
//     compares task-a-*.<suffix>.csv with the original labels, and rescores the system
//     against the new labels using the reports saved in the latest evaluation run.
//   Task B: node eval/annotation/agreement.js <suffixA> <suffixB>
//     compares two raters' task-b-*.<suffix>.csv files and relates their ratings to the
//     verifier's decisions in the latest live run.
// Results and disagreement lists are written next to the sheets.
const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const evalDir = path.join(here, '..');

function parseCsv(text) {
  const rows = [];
  let row = [],
    field = '',
    quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') ((field += '"'), i++);
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') (row.push(field), (field = ''));
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      (row.push(field), rows.push(row), (row = []), (field = ''));
    } else field += c;
  }
  if (field || row.length) (row.push(field), rows.push(row));
  const [header, ...body] = rows.filter((r) => r.some((v) => v !== ''));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
}
const readSheet = (name) => parseCsv(fs.readFileSync(path.join(here, name), 'utf8'));
const writeCsv = (name, rows) =>
  fs.writeFileSync(
    path.join(here, name),
    '﻿' +
      rows
        .map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\r\n') +
      '\r\n'
  );

// Cohen's kappa for two lists of categorical labels of equal length.
function kappa(a, b) {
  const n = a.length;
  if (!n) return null;
  const labels = [...new Set([...a, ...b])];
  const observed = a.filter((x, i) => x === b[i]).length / n;
  const expected = labels.reduce(
    (s, l) => s + (a.filter((x) => x === l).length / n) * (b.filter((x) => x === l).length / n),
    0
  );
  return {
    n,
    agreement: observed,
    kappa: expected === 1 ? 1 : (observed - expected) / (1 - expected),
  };
}
const SENT = {
  pos: 'positive',
  neg: 'negative',
  neu: 'neutral',
  positive: 'positive',
  negative: 'negative',
  neutral: 'neutral',
};
const topicsOf = (cell) =>
  cell
    .split(/[;,]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

function latest(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('ocr-'))
    .map((d) => d.name)
    .sort()
    .at(-1);
}

function taskA(suffix) {
  const truths = fs
    .readdirSync(path.join(evalDir, 'profiles'))
    .filter((f) => /^p\d\d\.truth\.json$/.test(f))
    .map((f) => JSON.parse(fs.readFileSync(path.join(evalDir, 'profiles', f), 'utf8')));
  const gold = new Map(truths.flatMap((t) => t.posts.map((p) => [p.postId, p])));
  const goldLikes = new Map(truths.flatMap((t) => t.likes.map((l) => [l.likeId, l])));
  const posts = readSheet(`task-a-posts.${suffix}.csv`);
  const likes = readSheet(`task-a-likes.${suffix}.csv`);
  const pairs = posts.filter((r) => gold.has(r.item_id));
  const topicKappa = (rows, goldMap, idKey) => {
    const all = [...new Set([...goldMap.values()].flatMap((g) => g.topics))].sort();
    const a = [],
      b = [],
      perTopic = {};
    for (const t of all) {
      const ta = [],
        tb = [];
      for (const r of rows) {
        const g = goldMap.get(r[idKey]);
        ta.push(g.topics.includes(t) ? 1 : 0);
        tb.push(topicsOf(r.topics).includes(t) ? 1 : 0);
      }
      perTopic[t] = kappa(ta, tb);
      (a.push(...ta), b.push(...tb));
    }
    return { pooledItemTopic: kappa(a, b), perTopic };
  };
  const disagreements = [['item_id', 'field', 'original', 'annotator', 'text']];
  for (const r of pairs) {
    const g = gold.get(r.item_id);
    if (r.language !== g.language)
      disagreements.push([r.item_id, 'language', g.language, r.language, r.text]);
    if (SENT[r.sentiment] !== g.sentiment)
      disagreements.push([r.item_id, 'sentiment', g.sentiment, r.sentiment, r.text]);
    const ga = [...g.topics].sort().join(';'),
      aa = topicsOf(r.topics).sort().join(';');
    if (ga !== aa) disagreements.push([r.item_id, 'topics', ga, aa, r.text]);
  }
  for (const r of likes.filter((l) => goldLikes.has(l.item_id))) {
    const ga = [...goldLikes.get(r.item_id).topics].sort().join(';'),
      aa = topicsOf(r.topics).sort().join(';');
    if (ga !== aa)
      disagreements.push([r.item_id, 'like_topics', ga, aa, `${r.page_name} (${r.page_category})`]);
  }
  writeCsv(`task-a-disagreements.${suffix}.csv`, disagreements);

  // Rescore the system against the annotator's labels, using the saved reports.
  const run = latest(path.join(evalDir, 'results'));
  const reports = Object.fromEntries(
    truths.map((t) => [
      t.id,
      JSON.parse(
        fs.readFileSync(path.join(evalDir, 'results', run, `${t.id}.report.json`), 'utf8')
      ),
    ])
  );
  const predicted = new Map(),
    predictedTopics = new Map();
  for (const rep of Object.values(reports)) {
    const f = rep.features || rep.report?.features;
    (f['text.languages']?.value?.perPost || []).forEach((l) =>
      predicted.set(l.postId, { ...(predicted.get(l.postId) || {}), language: l.language })
    );
    (f['text.sentiment']?.value?.posts || []).forEach((s) =>
      predicted.set(s.postId, { ...(predicted.get(s.postId) || {}), sentiment: s.label })
    );
    (f['text.topics']?.value || []).forEach((t) =>
      t.postIds.forEach((id) =>
        predictedTopics.set(id, [...(predictedTopics.get(id) || []), t.topic])
      )
    );
  }
  const english = pairs.filter((r) => r.language === 'en');
  const scored = english.filter(
    (r) => (predicted.get(r.item_id)?.sentiment || 'unscored') !== 'unscored'
  );
  let tp = 0,
    fp = 0,
    fn = 0;
  for (const r of english) {
    const p = new Set(predictedTopics.get(r.item_id) || []),
      t = new Set(topicsOf(r.topics));
    tp += [...p].filter((x) => t.has(x)).length;
    fp += [...p].filter((x) => !t.has(x)).length;
    fn += [...t].filter((x) => !p.has(x)).length;
  }
  const result = {
    suffix,
    evaluationRun: run,
    items: { posts: pairs.length, likes: likes.length },
    agreementWithOriginalLabels: {
      language: kappa(
        pairs.map((r) => gold.get(r.item_id).language),
        pairs.map((r) => r.language)
      ),
      sentiment: kappa(
        pairs.map((r) => gold.get(r.item_id).sentiment),
        pairs.map((r) => SENT[r.sentiment] || r.sentiment)
      ),
      postTopics: topicKappa(pairs, gold, 'item_id'),
      likeTopics: topicKappa(
        likes.filter((l) => goldLikes.has(l.item_id)),
        goldLikes,
        'item_id'
      ),
    },
    systemAgainstAnnotator: {
      languageAccuracy:
        pairs.filter((r) => predicted.get(r.item_id)?.language === r.language).length /
        pairs.length,
      sentimentAccuracyScoredEnglish: scored.length
        ? scored.filter((r) => predicted.get(r.item_id).sentiment === SENT[r.sentiment]).length /
          scored.length
        : null,
      englishPostTopics: { tp, fp, fn, precision: tp / (tp + fp), recall: tp / (tp + fn) },
    },
  };
  fs.writeFileSync(
    path.join(here, `task-a-results.${suffix}.json`),
    JSON.stringify(result, null, 2) + '\n'
  );
  return result;
}

function taskB(a, b) {
  const live = path.join(evalDir, 'live', latest(path.join(evalDir, 'live')));
  const items = JSON.parse(fs.readFileSync(path.join(live, 'items.json'), 'utf8'));
  const outcome = new Map(
    items.flatMap((p) => p.inference.map((g) => [`${p.id}-g${g.index}`, g.outcome]))
  );
  const sentenceOutcome = new Map(
    items.flatMap((p) => [
      ...p.explanations.map((s, i) => [`${p.id}-e${i}`, s]),
      ...p.summary.sentences.map((s, i) => [`${p.id}-s${i}`, s]),
    ])
  );
  const ga = readSheet(`task-b-guesses.${a}.csv`),
    gb = new Map(readSheet(`task-b-guesses.${b}.csv`).map((r) => [r.item_id, r]));
  const sa = readSheet(`task-b-sentences.${a}.csv`),
    sb = new Map(readSheet(`task-b-sentences.${b}.csv`).map((r) => [r.item_id, r]));
  const guesses = ga.filter((r) => gb.has(r.item_id));
  const sentences = sa.filter((r) => sb.has(r.item_id));
  const disagreements = [['item_id', 'field', a, b]];
  guesses.forEach((r) => {
    const o = gb.get(r.item_id);
    if (r.support !== o.support) disagreements.push([r.item_id, 'support', r.support, o.support]);
    if (r.valid_value !== o.valid_value)
      disagreements.push([r.item_id, 'valid_value', r.valid_value, o.valid_value]);
  });
  sentences.forEach((r) => {
    const o = sb.get(r.item_id);
    if (r.faithful !== o.faithful)
      disagreements.push([r.item_id, 'faithful', r.faithful, o.faithful]);
  });
  writeCsv(`task-b-disagreements.${a}-${b}.csv`, disagreements);
  // Before adjudication an item counts as supported only if both raters say so.
  const both = (r, field, value) =>
    r[field] === value && (gb.get(r.item_id) || sb.get(r.item_id))[field] === value;
  const accepted = guesses.filter((r) => outcome.get(r.item_id) === 'accepted');
  const rejected = guesses.filter((r) => String(outcome.get(r.item_id)).startsWith('rejected'));
  const layers = (filter) => {
    const rows = sentences.filter((r) => filter(sentenceOutcome.get(r.item_id)));
    return {
      n: rows.length,
      faithfulBoth: rows.filter((r) => both(r, 'faithful', 'yes')).length,
      notFaithfulBoth: rows.filter((r) => both(r, 'faithful', 'no')).length,
    };
  };
  const result = {
    raters: [a, b],
    liveRun: path.basename(live),
    agreement: {
      guessSupport: kappa(
        guesses.map((r) => r.support),
        guesses.map((r) => gb.get(r.item_id).support)
      ),
      guessValidValue: kappa(
        guesses.map((r) => r.valid_value),
        guesses.map((r) => gb.get(r.item_id).valid_value)
      ),
      sentenceFaithful: kappa(
        sentences.map((r) => r.faithful),
        sentences.map((r) => sb.get(r.item_id).faithful)
      ),
    },
    acceptedGuesses: {
      n: accepted.length,
      supportedBoth: accepted.filter((r) => both(r, 'support', 'supported')).length,
      unsupportedBoth: accepted.filter((r) => both(r, 'support', 'unsupported')).length,
      invalidValueBoth: accepted.filter((r) => both(r, 'valid_value', 'no')).length,
    },
    rejectedGuesses: {
      n: rejected.length,
      supportedBoth: rejected.filter((r) => both(r, 'support', 'supported')).length,
    },
    sentencesByVerifierLayer: {
      generated: layers(() => true),
      passDeterministic: layers((s) => s?.deterministicPass),
      passJudgeAlone: layers((s) => s?.keysOk && s?.judge),
      passBoth: layers((s) => s?.productionAccepted),
      rejectedByNumbersOnly: layers((s) => s?.keysOk && !s?.numbersOk && s?.judge),
      rejectedByJudge: layers((s) => s?.keysOk && s?.numbersOk && !s?.judge),
    },
  };
  fs.writeFileSync(
    path.join(here, `task-b-results.${a}-${b}.json`),
    JSON.stringify(result, null, 2) + '\n'
  );
  return result;
}

if (require.main === module) {
  const [a, b] = process.argv.slice(2);
  if (!a) {
    process.stderr.write('usage: node eval/annotation/agreement.js <suffix> [<second suffix>]\n');
    process.exitCode = 1;
  } else process.stdout.write(`${JSON.stringify(b ? taskB(a, b) : taskA(a), null, 2)}\n`);
}
module.exports = { parseCsv, kappa };
