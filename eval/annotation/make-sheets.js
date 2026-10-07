'use strict';
// Builds the blank annotation sheets from the fixtures and a recorded live-model run.
// Task A sheets contain no labels and no system output. Task B sheets do not show the
// verifier's decision. Usage: node eval/annotation/make-sheets.js [liveRunDir]
const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const evalDir = path.join(here, '..');
const csv = (rows) =>
  '﻿' +
  rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n') +
  '\r\n';
const personas = fs
  .readdirSync(path.join(evalDir, 'profiles'))
  .filter((f) => /^p\d\d\.json$/.test(f))
  .map((f) => JSON.parse(fs.readFileSync(path.join(evalDir, 'profiles', f), 'utf8')));

const posts = [['item_id', 'persona', 'text', 'language', 'sentiment', 'topics', 'notes']];
const likes = [['item_id', 'persona', 'page_name', 'page_category', 'topics', 'notes']];
for (const p of personas) {
  for (const post of p.posts.data)
    posts.push([post.id, p.id, post.message || post.story || '', '', '', '', '']);
  for (const like of p.likes.data)
    likes.push([like.id, p.id, like.name, like.category || '', '', '']);
}
fs.writeFileSync(path.join(here, 'task-a-posts.csv'), csv(posts));
fs.writeFileSync(path.join(here, 'task-a-likes.csv'), csv(likes));

const liveDir =
  process.argv[2] ||
  path.join(
    evalDir,
    'live',
    fs
      .readdirSync(path.join(evalDir, 'live'))
      .filter((d) => !d.startsWith('.'))
      .sort()
      .at(-1)
  );
const items = JSON.parse(fs.readFileSync(path.join(liveDir, 'items.json'), 'utf8'));
const calls = JSON.parse(fs.readFileSync(path.join(liveDir, 'calls.json'), 'utf8'));
const guesses = [
  [
    'item_id',
    'persona',
    'attribute',
    'guess',
    'cited_quotes_and_full_posts',
    'valid_value',
    'support',
    'notes',
  ],
];
const sentences = [
  ['item_id', 'persona', 'kind', 'sentence', 'cited_findings_json', 'faithful', 'notes'],
];
for (const p of items) {
  for (const g of p.inference) {
    if (g.guess === null) continue;
    const evidence = g.evidence
      .map((e) => `QUOTE: ${e.quote}\nFULL POST (${e.postId}): ${e.postText ?? '[unknown post]'}`)
      .join('\n\n');
    guesses.push([`${p.id}-g${g.index}`, p.id, g.attribute, g.guess, evidence, '', '', '']);
  }
  // Section explanations: the findings the sentence cites, as the generator saw them.
  const section = calls.filter(
    (c) =>
      c.template.startsWith('explain-') &&
      c.template !== 'explain-profile' &&
      Object.values(c.payload).some((f) => (f.inputs || []).some((s) => s.startsWith(p.id)))
  );
  const features = Object.assign({}, ...section.map((c) => c.payload));
  p.explanations.forEach((s, i) => {
    const cited = Object.fromEntries(
      (s.supportedBy || []).map((k) => [
        k,
        features[k] ? { value: features[k].value, n: features[k].n } : null,
      ])
    );
    sentences.push([`${p.id}-e${i}`, p.id, 'explanation', s.text, JSON.stringify(cited), '', '']);
  });
  const profileCall = calls.find(
    (c) =>
      c.template === 'explain-profile' &&
      Object.values(c.payload).some((f) => (f.inputs || []).some((s) => s.startsWith(p.id)))
  );
  p.summary.sentences.forEach((s, i) => {
    const cited = Object.fromEntries(
      (s.supportedBy || []).map((k) => [
        k,
        profileCall?.payload[k]
          ? { value: profileCall.payload[k].value, n: profileCall.payload[k].n }
          : null,
      ])
    );
    sentences.push([
      `${p.id}-s${i}`,
      p.id,
      'profile_summary',
      s.text,
      JSON.stringify(cited),
      '',
      '',
    ]);
  });
}
fs.writeFileSync(path.join(here, 'task-b-guesses.csv'), csv(guesses));
fs.writeFileSync(path.join(here, 'task-b-sentences.csv'), csv(sentences));
process.stdout.write(
  `posts ${posts.length - 1}, likes ${likes.length - 1}, guesses ${guesses.length - 1}, sentences ${sentences.length - 1}\n`
);
