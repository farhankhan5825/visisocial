'use strict';
// Builds Graph-shaped fixtures, ground truth and authored provider doubles from
// eval/fixtures-source.js. Truth is copied from the hand annotations in that file;
// nothing here runs an analyzer.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { PROFILES, PROTOCOL_VERSION } = require('./fixtures-source');

const root = path.join(__dirname, 'profiles');

// prettier-ignore
const shape = {
  Book: '<rect x="30" y="30" width="100" height="100" fill="#276795"/><path d="M80 30v100" stroke="white" stroke-width="4"/>',
  Tree: '<path d="M70 125V65" stroke="#7b5137" stroke-width="12"/><circle cx="70" cy="50" r="35" fill="#3d8a50"/>',
  House: '<rect x="35" y="65" width="90" height="65" fill="#cca874"/><path d="M20 65L80 10l60 55z" fill="#bb5a53"/>',
  Car: '<rect x="20" y="70" width="120" height="40" rx="8" fill="#326f98"/><circle cx="45" cy="115" r="12" fill="#222"/><circle cx="115" cy="115" r="12" fill="#222"/>',
};

// Offset (ms) of `timezone` at instant `utcMs`, via the wall-clock time Intl reports.
function offsetAt(utcMs, timezone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value])
  );
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return wall - utcMs;
}

// "2026-05-02 21:10" wall time in `timezone` -> Graph API style "2026-05-02T20:10:00+0000".
function graphTimestamp(local, timezone) {
  const [date, time] = local.split(' ');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, hh, mm);
  let utc = wallAsUtc;
  for (let i = 0; i < 2; i++) utc = wallAsUtc - offsetAt(utc, timezone);
  return new Date(utc).toISOString().replace(/\.\d{3}Z$/, '+0000');
}

function modes(values) {
  const counts = new Map();
  values.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
  const max = Math.max(...counts.values());
  return [...counts]
    .filter(([, n]) => n === max)
    .map(([v]) => v)
    .sort((a, b) => a - b);
}

function buildProfile(source, index) {
  const id = `p${String(index + 1).padStart(2, '0')}`;
  const posts = source.posts.map(([local, , , , text], i) => ({
    id: `${id}-post-${i + 1}`,
    message: text,
    created_time: graphTimestamp(local, source.timezone),
  }));
  const likes = source.likes.map(([name, category], i) => ({
    id: `${id}-like-${i + 1}`,
    name,
    category,
  }));
  const subjects = index % 2 ? ['Tree', 'Book', 'Car', 'House'] : ['Book', 'Tree', 'House', 'Car'];
  const photoTruth = subjects.map((subject, i) => ({
    photoId: `${id}-photo-${i + 1}`,
    text: `BOOKS ${i + 1}`,
    labels: [subject],
    subject,
  }));
  const photos = photoTruth.map((p) => ({
    id: p.photoId,
    images: [{ source: `fixture://${p.photoId}.png` }],
  }));
  const profile = {
    id,
    name: source.name,
    email: `${id}@example.test`,
    timezone: source.timezone,
    posts: { data: posts },
    likes: { data: likes },
    photos: { data: photos },
  };

  const postTruth = source.posts.map(([local, language, sentiment, topics], i) => ({
    postId: posts[i].id,
    localHour: Number(local.slice(11, 13)),
    language,
    sentiment: { pos: 'positive', neg: 'negative', neu: 'neutral' }[sentiment],
    topics,
  }));
  const topicCounts = {};
  postTruth.forEach((p) => p.topics.forEach((t) => (topicCounts[t] = (topicCounts[t] || 0) + 1)));
  const languageCounts = {};
  postTruth.forEach((p) => (languageCounts[p.language] = (languageCounts[p.language] || 0) + 1));
  const breaches =
    index % 2
      ? []
      : [
          {
            Name: 'SyntheticExample',
            BreachDate: '2020-01-01',
            DataClasses: ['Email addresses', 'Passwords'],
          },
        ];
  const truth = {
    id,
    protocolVersion: PROTOCOL_VERSION,
    annotation: 'single_annotator_written_with_posts',
    name: source.name,
    timezone: source.timezone,
    languageCounts,
    posts: postTruth,
    likes: source.likes.map(([, , topics], i) => ({ likeId: likes[i].id, topics })),
    peakHours: modes(postTruth.map((p) => p.localHour)),
    topics: Object.keys(topicCounts)
      .filter((t) => topicCounts[t] >= 2)
      .sort(),
    interests: [...new Set(source.likes.flatMap(([, , topics]) => topics))].sort(),
    city: source.city,
    inference: [`location:${source.city}`],
    photoTruth,
    breaches,
  };

  // Authored response doubles for contract checks only; never recorded service output.
  const cityPost = posts[source.cityPost];
  const mocks = {
    provenance: 'authored_synthetic_provider_double_v2',
    vision: Object.fromEntries(
      photoTruth.map((p, i) => [
        p.photoId,
        {
          fullTextAnnotation: { text: i === 3 ? `B00KS ${i + 1}` : p.text },
          labelAnnotations: [{ description: i === 3 ? 'IncorrectLabel' : p.subject, score: 0.8 }],
          localizedObjectAnnotations: [],
          logoAnnotations: [],
          landmarkAnnotations: [],
        },
      ])
    ),
    inference: {
      items: [
        {
          attribute: 'location',
          guess: source.city,
          evidence: [{ postId: cityPost.id, quote: cityPost.message }],
          certainty: 'low',
        },
        {
          attribute: 'occupation',
          guess: 'engineer',
          evidence: [{ postId: posts[0].id, quote: 'unsupported quote' }],
          certainty: 'high',
        },
      ],
    },
    breaches,
  };
  return { id, profile, truth, mocks, photoTruth };
}

async function build() {
  fs.mkdirSync(root, { recursive: true });
  for (const [index, source] of PROFILES.entries()) {
    const { id, profile, truth, mocks, photoTruth } = buildProfile(source, index);
    for (const [suffix, data] of [
      ['', profile],
      ['.truth', truth],
      ['.mocks', mocks],
    ]) {
      fs.writeFileSync(
        path.join(root, `${id}${suffix}.json`),
        JSON.stringify(data, null, 2) + '\n'
      );
    }
    for (const photo of photoTruth) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="260"><rect width="600" height="260" fill="white"/>${shape[photo.subject]}<text x="170" y="105" font-family="sans-serif" font-size="54" fill="black">${photo.text}</text></svg>`;
      fs.writeFileSync(path.join(root, `${photo.photoId}.svg`), svg);
      await sharp(Buffer.from(svg))
        .png()
        .toFile(path.join(root, `${photo.photoId}.png`));
    }
  }
}

if (require.main === module)
  build().catch((error) => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
module.exports = { build, buildProfile, graphTimestamp };
