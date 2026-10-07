'use strict';
// View model for the console: a stream of the user's own items, and findings that point
// back at the exact items they were derived from. Every value comes from the stored
// report; nothing is estimated here.
const { present, TOPIC_NAMES } = require('./present');
const { heldBack, guessNote } = require('./pages');
const { TRAITS, meaningfulGuess } = require('../analysis/inference');

const topicName = (t) => TOPIC_NAMES[t] || t;
const ok = (report, key) => {
  const f = report.features[key];
  return f && f.status === 'ok' ? f : null;
};
const clip = (text, max) =>
  !text ? '' : text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
const hh = (h) => `${String(h).padStart(2, '0')}:00`;

function parseTime(time) {
  if (!time) return null;
  const d = new Date(time.replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
  return Number.isFinite(d.getTime()) ? d : null;
}
function localParts(date, timezone) {
  if (!date) return { label: '', hour: null };
  try {
    const label = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date);
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(date)
    );
    return { label, hour };
  } catch {
    return { label: '', hour: null };
  }
}

function findings(report) {
  const out = [];
  const tz = report.metadata?.timezone;
  const posts = report.sources?.posts || {};
  const add = (f) =>
    out.push({
      quotes: [],
      limitations: [],
      ...f,
      id: `F${String(out.length + 1).padStart(2, '0')}`,
    });
  const quotes = (ids, n = 3) =>
    ids
      .filter((id) => posts[id])
      .slice(0, n)
      .map((id) => ({ ref: id, text: clip(posts[id].text, 220) }));

  const guesses = ok(report, 'inference.guesses');
  if (guesses) {
    guesses.value.forEach((g, index) => {
      if (!meaningfulGuess(g.guess, g.attribute)) return;
      add({
        layer: 'guessed',
        name: g.attribute.replace('_', ' '),
        value: g.guess,
        sources: g.evidence.map((e) => e.postId),
        claim: `An AI model guessed your ${g.attribute.replace('_', ' ')} is "${g.guess}". Its own certainty label: ${g.certainty}.`,
        quotes: g.evidence.map((e) => ({ ref: e.postId, text: clip(e.quote, 220) })),
        method: guesses.method,
        limitations: guesses.limitations,
        feedbackIndex: index,
      });
    });
  }

  const peak = ok(report, 'temporal.peakHours');
  if (peak) {
    const atPeak = Object.keys(posts).filter((id) =>
      peak.value.includes(localParts(parseTime(posts[id].time), tz).hour)
    );
    add({
      layer: 'computed',
      name: 'peak hour',
      value: peak.value.map(hh).join(', '),
      sources: atPeak,
      claim: `Your most common posting hour is ${peak.value.map(hh).join(' and ')} (${tz}), from ${peak.n} dated posts.`,
      quotes: quotes(atPeak),
      method: peak.method,
      limitations: peak.limitations,
    });
  }
  const sentiment = ok(report, 'text.sentiment');
  if (sentiment) {
    const d = sentiment.value.distribution;
    const scored = sentiment.value.posts.filter((p) => p.score !== null);
    const top = Object.entries({
      positive: d.positive,
      neutral: d.neutral,
      negative: d.negative,
    }).sort((a, b) => b[1] - a[1])[0];
    const strongest = [...scored].sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 3);
    add({
      layer: 'computed',
      name: 'tone',
      value: `mostly ${top[0]} (${top[1]}/${d.positive + d.neutral + d.negative})`,
      sources: scored.map((p) => p.postId),
      claim: `${d.positive} positive, ${d.neutral} neutral and ${d.negative} negative posts; ${d.unscored} not scored. This describes wording, not mood.`,
      quotes: quotes(strongest.map((p) => p.postId)),
      method: sentiment.method,
      limitations: sentiment.limitations,
    });
  }
  const topics = ok(report, 'text.topics');
  if (topics) {
    for (const t of topics.value) {
      add({
        layer: 'computed',
        name: 'topic',
        value: topicName(t.topic).toLowerCase(),
        sources: t.postIds,
        claim: `${t.count} of your posts use words from the ${topicName(t.topic).toLowerCase()} list.`,
        quotes: quotes(t.postIds, 2),
        method: topics.method,
        limitations: topics.limitations,
      });
    }
  }
  const readability = ok(report, 'text.readability');
  if (readability) {
    add({
      layer: 'computed',
      name: 'reading ease',
      value: String(Math.round(readability.value.fleschReadingEase)),
      sources: readability.inputs,
      claim: `Flesch reading ease ${Math.round(readability.value.fleschReadingEase)} over ${readability.value.sentences} English sentences. Sentence and word length only; nothing about education.`,
      method: readability.method,
      limitations: readability.limitations,
    });
  }

  const interests = ok(report, 'interests.categories');
  if (interests) {
    const likes = report.sources?.likes || {};
    for (const c of interests.value) {
      add({
        layer: 'observed',
        name: 'interest',
        value: topicName(c.topic).toLowerCase(),
        sources: c.likeIds,
        claim: `You liked ${c.likeIds.length} page${c.likeIds.length === 1 ? '' : 's'} in this category: ${c.likeIds
          .map((id) => likes[id]?.name)
          .filter(Boolean)
          .join(', ')}. Advertisers can target interest categories like this.`,
        method: interests.method,
        limitations: interests.limitations,
      });
    }
  }
  const photos = ok(report, 'image.observations');
  if (photos) {
    for (const p of photos.value) {
      const labels = [...p.labels, ...p.objects, ...p.logos, ...p.landmarks].map((l) => l.label);
      add({
        layer: 'observed',
        name: 'photo',
        value: clip(
          labels.slice(0, 3).join(', ').toLowerCase() || (p.text ? `text: ${p.text}` : 'no labels'),
          40
        ),
        sources: [p.photoId],
        claim: `${p.method === 'google_vision' ? 'Google Cloud Vision' : 'Local OCR'} reports ${
          labels.length ? labels.join(', ') : 'no labels'
        }${p.text ? `, and reads the text "${clip(p.text, 120)}"` : ''}.`,
        method: photos.method,
        limitations: photos.limitations,
      });
    }
  }
  const breaches = ok(report, 'osint.breaches');
  if (breaches) {
    for (const b of breaches.value) {
      add({
        layer: 'observed',
        name: 'breach',
        value: b.name,
        sources: [],
        claim: `Your account email appears in the ${b.name} breach (${b.date}). Exposed: ${b.dataClasses.join(', ')}. Source: Have I Been Pwned, CC BY 4.0.`,
        method: breaches.method,
        limitations: breaches.limitations,
      });
    }
  }
  return out;
}

function stream(report, used) {
  const tz = report.metadata?.timezone;
  const items = [];
  for (const [id, p] of Object.entries(report.sources?.posts || {})) {
    const date = parseTime(p.time);
    items.push({
      id,
      kind: 'post',
      when: localParts(date, tz).label,
      sort: date ? date.getTime() : 0,
      text: clip(p.text, 140),
    });
  }
  items.sort((a, b) => b.sort - a.sort);
  for (const [id, l] of Object.entries(report.sources?.likes || {})) {
    items.push({
      id,
      kind: 'like',
      when: '',
      text: l.category ? `${l.name} (${l.category})` : l.name,
    });
  }
  for (const p of ok(report, 'image.observations')?.value || []) {
    items.push({ id: p.photoId, kind: 'photo', when: '', text: clip(p.text || 'photo', 140) });
  }
  return items.map((i) => ({ ...i, usedBy: used.get(i.id) || 0 }));
}

function hoursStrip(report) {
  const hist = ok(report, 'temporal.hourHistogram');
  if (!hist) return null;
  const peaks = ok(report, 'temporal.peakHours')?.value || [];
  const max = Math.max(...hist.value, 1);
  return hist.value.map((v, h) => ({
    h,
    v,
    pct: Math.round((v / max) * 100),
    peak: peaks.includes(h),
  }));
}

function sentimentHistory(report) {
  const posts = report.sources?.posts || {};
  const values = (ok(report, 'text.sentiment')?.value.posts || [])
    .filter((p) => Number.isFinite(p.score) && parseTime(posts[p.postId]?.time))
    .map((p) => ({ ...p, date: parseTime(posts[p.postId].time) }))
    .sort((a, b) => a.date - b.date);
  if (!values.length) return null;
  const first = values[0].date.getTime();
  const range = values[values.length - 1].date.getTime() - first;
  const points = values.map((p) => ({
    id: p.postId,
    x: range ? 30 + ((p.date.getTime() - first) / range) * 520 : 290,
    y: 100 - Math.max(-1, Math.min(1, p.score)) * 70,
    label: `${localParts(p.date, report.metadata?.timezone).label}: ${p.label}, ${p.score.toFixed(2)}`,
    tone: p.label,
  }));
  return {
    points,
    path: points.map((p) => `${p.x},${p.y}`).join(' '),
    start: localParts(values[0].date, report.metadata?.timezone).label,
    end: localParts(values[values.length - 1].date, report.metadata?.timezone).label,
  };
}

function profileGraph(list) {
  // One node per actual finding, with distinct categories before filling extra nodes.
  const selected = [];
  for (const name of [...new Set(list.map((f) => f.name))]) {
    selected.push(list.find((f) => f.name === name));
  }
  return selected.slice(0, 10).map((f, i, nodes) => {
    const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    return {
      ...f,
      x: Math.round(300 + Math.cos(angle) * 205),
      y: Math.round(155 + Math.sin(angle) * 115),
      label: clip(f.value, 23),
    };
  });
}

function profileSummary(report, list) {
  const profile = report.explanations?.profile;
  if (
    profile?.status === 'ok' &&
    profile.format === 'personal_portrait_v1' &&
    profile.sentences?.length
  ) {
    const text = profile.sentences.map((s) => s.text).join(' ');
    if (
      profile.sentences.length <= 3 &&
      text.trim().split(/\s+/).length <= 65 &&
      !/\d/.test(text)
    ) {
      return { title: 'AI profile summary', text };
    }
  }
  // Existing reports get a portrait based on their stored findings, without another
  // provider call. Keep inferred life details and traits explicitly tentative.
  const lines = [];
  const role = list.find((f) => f.name === 'occupation');
  const location = list.find((f) => f.name === 'location');
  if (role)
    lines.push(
      `Your posts suggest your work or studies may involve ${role.value}${location ? `, with ties to ${location.value}` : ''}.`
    );
  else if (location)
    lines.push(`You appear to have ties to ${location.value}, based on what you share.`);
  const interests = list.filter((f) => f.name === 'interest').slice(0, 2);
  const topics = list.filter((f) => f.name === 'topic').slice(0, 2);
  if (interests.length)
    lines.push(
      `The interests you share through liked pages include ${interests.map((f) => f.value).join(' and ')}.`
    );
  else if (topics.length)
    lines.push(`You share posts about ${topics.map((f) => f.value).join(' and ')}.`);
  const trait = list.find((f) => TRAITS.includes(f.name));
  if (trait)
    lines.push(
      `You come across as ${trait.value} in some posts; this is a tentative AI impression.`
    );
  const selected = [];
  for (const line of lines) {
    if ([...selected, line].join(' ').trim().split(/\s+/).length <= 65) selected.push(line);
  }
  return { title: 'Profile snapshot', text: selected.slice(0, 3).join(' ') };
}

function consoleView(report, identity) {
  const list = findings(report);
  const used = new Map();
  list.forEach((f) => f.sources.forEach((id) => used.set(id, (used.get(id) || 0) + 1)));
  const items = stream(report, used);
  const view = present(report);
  const counts = { observed: 0, computed: 0, guessed: 0 };
  list.forEach((f) => counts[f.layer]++);
  const tone = ok(report, 'text.sentiment')?.value.distribution || null;
  const toneTotal = tone ? tone.positive + tone.neutral + tone.negative + tone.unscored : 0;
  return {
    identity,
    findings: list,
    stream: items,
    kinds: {
      post: items.filter((i) => i.kind === 'post').length,
      like: items.filter((i) => i.kind === 'like').length,
      photo: items.filter((i) => i.kind === 'photo').length,
    },
    counts,
    held: heldBack(report),
    guessNote: guessNote(report),
    hours: hoursStrip(report),
    tone: tone
      ? ['positive', 'neutral', 'negative', 'unscored'].map((k) => ({
          k,
          v: tone[k],
          pct: toneTotal ? Math.round((tone[k] / toneTotal) * 100) : 0,
        }))
      : null,
    modules: view.overview.modules,
    explanations: view.explanations,
    summary: profileSummary(report, list),
    view,
    traits: TRAITS.map((name) => ({
      name,
      finding: list.find((f) => f.name === name) || null,
      invalid: Boolean(
        ok(report, 'inference.guesses')?.value.some(
          (g) => g.attribute === name && !meaningfulGuess(g.guess, name)
        )
      ),
    })),
    personalityEnabled: Boolean(report.modules.inference?.diagnostics?.personalityEnabled),
    graph: profileGraph(list),
    sentimentHistory: sentimentHistory(report),
    exposure: list.filter((f) => ['location', 'occupation', 'photo'].includes(f.name)),
    timezone: report.metadata?.timezone,
  };
}

module.exports = { consoleView, findings, stream, sentimentHistory, profileGraph, profileSummary };
