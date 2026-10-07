'use strict';
const { meaningfulGuess } = require('../analysis/inference');
// View models for the console pages. Everything is derived from the stored report; nothing
// here invents a number. Evidence items are classified into the three layers the paper
// distinguishes: observed items, computed statistics and AI guesses.
const { present, whyMissing, TOPIC_NAMES } = require('./present');

const topicName = (t) => TOPIC_NAMES[t] || t;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ok = (report, key) => {
  const f = report.features[key];
  return f && f.status === 'ok' ? f : null;
};
const clip = (text, max = 160) =>
  !text ? '' : text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
const hour = (h) => `${String(h).padStart(2, '0')}:00`;

function postQuotes(report, ids, limit = 3) {
  const posts = report.sources?.posts || {};
  return ids
    .filter((id) => posts[id])
    .slice(0, limit)
    .map((id) => ({ text: clip(posts[id].text), ref: id, time: posts[id].time }));
}
function likeNames(report, ids) {
  const likes = report.sources?.likes || {};
  return ids.map((id) => likes[id]?.name).filter(Boolean);
}
function localHour(time, timezone) {
  if (!time) return null;
  const iso = time.replace(/([+-]\d\d)(\d\d)$/, '$1:$2');
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  try {
    return Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(d)
    );
  } catch {
    return null;
  }
}

function stats(report) {
  const features = Object.values(report.features);
  const modules = Object.values(report.modules);
  return {
    posts: Object.keys(report.sources?.posts || {}).length,
    likes: Object.keys(report.sources?.likes || {}).length,
    photos: ok(report, 'image.observations')?.value.length ?? 0,
    findings: features.filter((f) => f.status === 'ok').length,
    abstained:
      features.filter((f) => f.status !== 'ok').length +
      modules.filter((m) => m.status !== 'ok').length,
    guesses:
      ok(report, 'inference.guesses')?.value.filter((g) => meaningfulGuess(g.guess, g.attribute))
        .length ?? 0,
  };
}

function chartData(report) {
  const data = {};
  const hist = ok(report, 'temporal.hourHistogram');
  if (hist) {
    data.hours = hist.value;
    data.peaks = ok(report, 'temporal.peakHours')?.value || [];
  }
  const sentiment = ok(report, 'text.sentiment');
  if (sentiment) data.tone = sentiment.value.distribution;
  const topics = ok(report, 'text.topics');
  if (topics) {
    const top = topics.value.slice(0, 8);
    data.topics = { labels: top.map((t) => topicName(t.topic)), values: top.map((t) => t.count) };
  }
  const interests = ok(report, 'interests.categories');
  if (interests) {
    const top = interests.value.slice(0, 8);
    data.interests = {
      labels: top.map((t) => topicName(t.topic)),
      values: top.map((t) => t.likeIds.length),
    };
  }
  return Object.keys(data).length ? data : null;
}

function evidence(report) {
  const items = [];
  const tz = report.metadata?.timezone;
  const push = (item) => items.push({ quotes: [], pages: [], limitations: [], ...item });

  // Observed: things the user did, shown as they are.
  const interests = ok(report, 'interests.categories');
  if (interests) {
    for (const c of interests.value) {
      push({
        layer: 'observed',
        title: `Interest: ${topicName(c.topic)}`,
        claim: `You liked ${plural(c.likeIds.length, 'page')} that ${c.likeIds.length === 1 ? 'maps' : 'map'} to ${topicName(c.topic).toLowerCase()}.`,
        how: c.via.includes('page_category') ? 'Facebook page category' : 'Page name keywords',
        method: interests.method,
        n: c.likeIds.length,
        pages: likeNames(report, c.likeIds).slice(0, 8),
        limitations: interests.limitations,
      });
    }
  }
  const photos = ok(report, 'image.observations');
  if (photos) {
    for (const p of photos.value) {
      const labels = [...p.labels, ...p.objects, ...p.logos, ...p.landmarks].map((l) => l.label);
      push({
        layer: 'observed',
        title: `Photo: ${labels.slice(0, 3).join(', ').toLowerCase() || 'no labels'}${p.text ? ', text read' : ''}`,
        claim: labels.length
          ? `Detected: ${labels.slice(0, 6).join(', ')}.`
          : 'No labels were detected.',
        how: p.method === 'google_vision' ? 'Google Cloud Vision' : 'Local OCR',
        method: photos.method,
        n: 1,
        quotes: p.text ? [{ text: clip(p.text), ref: `text in photo ${p.photoId}` }] : [],
        limitations: photos.limitations,
      });
    }
  }
  const breaches = ok(report, 'osint.breaches');
  if (breaches) {
    for (const b of breaches.value) {
      push({
        layer: 'observed',
        title: `Breach: ${b.name}`,
        claim: `Your account email is listed in the ${b.name} breach (${b.date}). Exposed: ${b.dataClasses.join(', ')}.`,
        how: 'Have I Been Pwned (CC BY 4.0)',
        method: breaches.method,
        n: 1,
        limitations: breaches.limitations,
      });
    }
  }

  // Computed: statistics over many items.
  const peak = ok(report, 'temporal.peakHours');
  if (peak) {
    const posts = report.sources?.posts || {};
    const atPeak = Object.keys(posts).filter((id) =>
      peak.value.includes(localHour(posts[id].time, tz))
    );
    push({
      layer: 'computed',
      title: 'Your posting rhythm',
      claim: `Your most common posting hour is ${peak.value.map(hour).join(' and ')} (${tz}). A routine like this tells a system when you are reachable.`,
      how: 'Hour-of-day histogram in your timezone',
      method: peak.method,
      n: peak.n,
      quotes: postQuotes(report, atPeak, 3),
      limitations: peak.limitations,
    });
  }
  const sentiment = ok(report, 'text.sentiment');
  if (sentiment) {
    const scored = sentiment.value.posts.filter((p) => p.score !== null);
    const strongest = [...scored].sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 3);
    const d = sentiment.value.distribution;
    push({
      layer: 'computed',
      title: 'The tone of your wording',
      claim: `${d.positive} positive, ${d.neutral} neutral and ${d.negative} negative posts; ${d.unscored} not scored.`,
      how: 'VADER sentiment, English posts only',
      method: sentiment.method,
      n: sentiment.n,
      quotes: postQuotes(
        report,
        strongest.map((p) => p.postId),
        3
      ).map((q, i) => ({
        ...q,
        note: `${strongest[i].label}, score ${strongest[i].score.toFixed(2)}`,
      })),
      limitations: sentiment.limitations,
    });
  }
  const topics = ok(report, 'text.topics');
  if (topics) {
    for (const t of topics.value.slice(0, 6)) {
      push({
        layer: 'computed',
        title: `Topic: ${topicName(t.topic)}`,
        claim: `${plural(t.count, 'post')} use words from the ${topicName(t.topic).toLowerCase()} list.`,
        how: 'Keyword taxonomy, whole words',
        method: topics.method,
        n: t.count,
        quotes: postQuotes(report, t.postIds, 2),
        limitations: topics.limitations,
      });
    }
  }

  // Guessed: model output, kept separate and challengeable.
  const guesses = ok(report, 'inference.guesses');
  if (guesses) {
    guesses.value.forEach((g, index) => {
      if (!meaningfulGuess(g.guess, g.attribute)) return;
      push({
        layer: 'guessed',
        title: `AI guess: ${g.attribute.replace('_', ' ')}`,
        guess: g.guess,
        claim: `An AI model guessed your ${g.attribute.replace('_', ' ')} is "${g.guess}" (its own certainty label: ${g.certainty}).`,
        how: 'Language model, quote checked word for word',
        method: guesses.method,
        n: g.evidence.length,
        quotes: g.evidence.map((e) => ({ text: clip(e.quote, 220), ref: e.postId })),
        limitations: guesses.limitations,
        feedbackIndex: index,
      });
    });
  }
  const counts = { observed: 0, computed: 0, guessed: 0 };
  items.forEach((i) => counts[i.layer]++);
  // Most consequential first: model guesses, then computed statistics, then raw observations.
  const order = { guessed: 0, computed: 1, observed: 2 };
  items.sort((a, b) => order[a.layer] - order[b.layer]);
  return { items, counts };
}

function layers(report, identity) {
  const s = stats(report);
  const ev = evidence(report);
  return {
    given: [
      { label: 'Name', value: identity?.name || 'Not shared' },
      { label: 'Email', value: identity?.email ? 'Shared with this app' : 'Not shared' },
      { label: 'Posts read', value: s.posts },
      { label: 'Page likes read', value: s.likes },
    ],
    observed: ev.counts.observed,
    computed: ev.counts.computed,
    guessed: ev.counts.guessed,
    abstained: s.abstained,
  };
}

// What three kinds of profiler do with signal types, tied to the user's own findings.
// General statements carry a source; user-specific lines only use computed values.
function watchers(report) {
  const peak = ok(report, 'temporal.peakHours');
  const interests = ok(report, 'interests.categories');
  const topics = ok(report, 'text.topics');
  const guesses = ok(report, 'inference.guesses');
  const breaches = ok(report, 'osint.breaches');
  const yours = (cond, text) => (cond ? text : null);
  return [
    {
      index: '01',
      name: 'The platform',
      what: 'A platform sees far more than any outside tool: everything it logs about how you use it, not just what you post. VisiSocial cannot see that; it shows the part you can inspect.',
      source: {
        label: 'Meta, Privacy Policy: information we collect',
        href: 'https://www.facebook.com/privacy/policy/',
      },
      yours: [
        yours(
          peak,
          peak &&
            `Your posts cluster around ${peak.value.map(hour).join(' & ')}, which is when you are most reachable.`
        ),
        yours(
          topics,
          topics &&
            `Your posts mention ${topics.value
              .slice(0, 3)
              .map((t) => topicName(t.topic).toLowerCase())
              .join(', ')}.`
        ),
      ].filter(Boolean),
    },
    {
      index: '02',
      name: 'Advertisers',
      what: 'Advertisers do not get your posts, but they can target audiences by interests and behaviours that the platform derives from activity such as page likes.',
      source: {
        label: 'Meta Business Help: ad targeting',
        href: 'https://www.facebook.com/business/ads/ad-targeting',
      },
      yours: [
        yours(
          interests,
          interests &&
            `Your likes fall into ${plural(interests.value.length, 'interest category', 'interest categories')}, led by ${interests.value
              .slice(0, 3)
              .map((t) => topicName(t.topic).toLowerCase())
              .join(', ')}.`
        ),
      ].filter(Boolean),
    },
    {
      index: '03',
      name: 'Data brokers and model inference',
      what: 'Brokers combine data from many sources, and research shows likes and ordinary text can predict private attributes. Large language models can do this from text alone.',
      source: {
        label: 'FTC (2014) Data Brokers; Kosinski et al. (2013) PNAS; Staab et al. (2024) ICLR',
        href: 'https://www.ftc.gov/reports/data-brokers-call-transparency-accountability-report-federal-trade-commission-may-2014',
      },
      yours: [
        yours(
          guesses,
          guesses &&
            `From your posts alone, an AI model made ${plural(guesses.value.length, 'guess', 'guesses')} it could back with a quote.`
        ),
        yours(
          breaches && breaches.value.length,
          breaches &&
            `Your email appears in ${plural(breaches.value.length, 'known breach', 'known breaches')}.`
        ),
      ].filter(Boolean),
    },
  ];
}

// ---------- Text charts: drawn with characters, from the real values only ----------

const SPARK = ' ▁▂▃▄▅▆▇█';
// One block character per hour; empty hours print as a faint dot so the axis stays readable.
function sparkline(values) {
  const max = Math.max(...values, 1);
  return values.map((v) => (v === 0 ? '·' : SPARK[Math.max(1, Math.round((v / max) * 8))]));
}
// A horizontal bar of `width` cells, filled in proportion to value / max.
function bar(value, max, width = 24) {
  const filled = max ? Math.round((value / max) * width) : 0;
  return {
    fill: '█'.repeat(Math.max(value ? 1 : 0, filled)),
    rest: '·'.repeat(width - Math.max(value ? 1 : 0, filled)),
  };
}
function barRows(items, width = 24) {
  const max = Math.max(...items.map((i) => i.value), 1);
  const label = Math.max(...items.map((i) => i.label.length));
  return items.map((i, index) => ({
    label: i.label.padEnd(label),
    ...bar(i.value, max, width),
    n: String(i.value),
    top: index === 0,
  }));
}

function charts(report) {
  const out = {};
  const hist = ok(report, 'temporal.hourHistogram');
  if (hist) {
    const peaks = ok(report, 'temporal.peakHours')?.value || [];
    out.hours = sparkline(hist.value).map((ch, h) => ({ ch, on: peaks.includes(h) }));
  }
  const sentiment = ok(report, 'text.sentiment');
  if (sentiment) {
    const d = sentiment.value.distribution;
    out.tone = barRows(
      [
        { label: 'positive', value: d.positive },
        { label: 'neutral', value: d.neutral },
        { label: 'negative', value: d.negative },
        { label: 'not scored', value: d.unscored },
      ],
      30
    ).map((r) => ({ ...r, top: false }));
  }
  const topics = ok(report, 'text.topics');
  if (topics)
    out.topics = barRows(
      topics.value
        .slice(0, 8)
        .map((t) => ({ label: topicName(t.topic).toLowerCase(), value: t.count }))
    );
  const interests = ok(report, 'interests.categories');
  if (interests)
    out.interests = barRows(
      interests.value
        .slice(0, 8)
        .map((t) => ({ label: topicName(t.topic).toLowerCase(), value: t.likeIds.length }))
    );
  return out;
}

// Parts that produced nothing, with the honest reason for each.
function heldBack(report) {
  const out = [];
  const NAMES = {
    text: 'post text',
    temporal: 'posting times',
    interests: 'page likes',
    image: 'photos',
    inference: 'AI guesses',
    osint: 'breach check',
  };
  for (const [key, m] of Object.entries(report.modules)) {
    if (m.status !== 'ok') out.push({ name: NAMES[key] || key, why: whyMissing(report, key) });
  }
  for (const [key, f] of Object.entries(report.features)) {
    const module = key.split('.')[0];
    if (f.status !== 'ok' && report.modules[module]?.status === 'ok')
      out.push({ name: key.replace('.', ' '), why: 'not enough evidence' });
  }
  return out;
}

// The profile as a tree: given -> observed -> computed -> guessed, every leaf a real finding.
function tree(report, identity) {
  const ev = evidence(report);
  const by = (layer) => ev.items.filter((i) => i.layer === layer);
  const held = heldBack(report);
  const s = stats(report);
  const branch = (items, leaf) =>
    items.map((item, i) => ({ last: i === items.length - 1, text: leaf(item) }));
  return {
    root: identity?.name || 'you',
    groups: [
      {
        name: 'given',
        note: 'what you handed over',
        leaves: branch(
          [
            `name: ${identity?.name || 'not shared'}`,
            `email: ${identity?.email ? 'shared with this app' : 'not shared'}`,
            `${s.posts} posts with text`,
            `${s.likes} page likes`,
          ],
          (t) => t
        ),
      },
      {
        name: 'observed',
        note: 'shown as they are',
        leaves: branch(by('observed'), (i) => `${i.title.toLowerCase()}  n=${i.n}`),
      },
      {
        name: 'computed',
        note: 'statistics over many items',
        leaves: branch(by('computed'), (i) => `${i.title.toLowerCase()}  n=${i.n}`),
      },
      {
        name: 'guessed',
        note: 'inferred by a model, quote attached',
        leaves: by('guessed').length
          ? branch(
              by('guessed'),
              (i) => `${i.title.replace('AI guess: ', '')}: ${i.guess}  (quote kept)`
            )
          : branch([guessNote(report)], (t) => t),
      },
      {
        name: 'held back',
        note: 'nothing filled in',
        leaves: branch(held, (h) => `${h.name}: ${h.why}`),
      },
    ],
    counts: { ...ev.counts, held: held.length },
  };
}
function guessNote(report) {
  const m = report.modules.inference;
  if (!m || m.status !== 'ok') return 'none: ' + (whyMissing(report, 'inference') || 'not run');
  const d = m.diagnostics || {};
  if (d.rejected) return `none passed the quote check (${d.rejected} of ${d.attempted} rejected)`;
  return 'none: the model found nothing it could quote';
}

function dashboard(report, identity) {
  const ev = evidence(report);
  return {
    view: present(report),
    stats: stats(report),
    counts: { ...ev.counts, held: heldBack(report).length },
    held: heldBack(report),
    charts: charts(report),
    guessNote: guessNote(report),
    firstName: (identity?.name || '').split(' ')[0] || 'there',
  };
}

module.exports = {
  dashboard,
  evidence,
  layers,
  tree,
  watchers,
  stats,
  chartData,
  charts,
  heldBack,
  guessNote,
  sparkline,
  bar,
  whyMissing,
};
