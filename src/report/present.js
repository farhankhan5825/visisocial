'use strict';
const { meaningfulGuess } = require('../analysis/inference');
// Turns a provenance-backed report into plain-language sections for the report page.
// Every sentence here is a deterministic template over feature values (no LLM), so the
// wording can never claim more than the numbers it is built from.

const TOPIC_NAMES = {
  technology: 'Technology',
  education: 'Education and study',
  work_career: 'Work and career',
  travel: 'Travel',
  food_drink: 'Food and drink',
  sports_fitness: 'Sport and fitness',
  music: 'Music',
  film_tv: 'Film and TV',
  arts_culture: 'Arts, books and culture',
  family_relationships: 'Family and relationships',
  health_wellbeing: 'Health and wellbeing',
  news_politics: 'News and politics',
  gaming: 'Gaming',
  nature_outdoors: 'Nature and outdoors',
  pets_animals: 'Pets and animals',
};
const LANGUAGE_NAMES = { en: 'English', es: 'Spanish', ur: 'Urdu', fr: 'French', de: 'German' };
const MODULE_NAMES = {
  text: 'Post text',
  temporal: 'Posting times',
  interests: 'Page likes',
  image: 'Photos',
  inference: 'AI attribute guesses',
  osint: 'Breach check',
};
const STATUS_TEXT = {
  ok: 'analysed',
  unavailable: 'not run',
  failed: 'failed; other sections are unaffected',
};

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (part, whole) => (whole ? Math.round((100 * part) / whole) : 0);
const hour = (h) => `${String(h).padStart(2, '0')}:00`;
const topicName = (t) => TOPIC_NAMES[t] || t;
const excerpt = (text, max = 140) =>
  !text ? '' : text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

function feature(report, key) {
  const f = report.features[key];
  return f && f.status === 'ok' ? f : null;
}

// Plain-language reasons for every way a module can end up without findings. The codes come
// from the modules themselves; anything unrecognised gets an honest generic sentence.
const SOURCE_NAMES = { posts: 'your posts', likes: 'your page likes', photos: 'your photos' };
function sourceFailure(source, code = '') {
  const what = SOURCE_NAMES[source] || source;
  if (/^graph_request_failed_(10|200|2\d\d)$/.test(code))
    return `Facebook refused access to ${what} (a permission was not granted).`;
  if (/^graph_request_failed_190$/.test(code))
    return 'Your Facebook login has expired. Log out and connect again.';
  if (/^graph_rate_or_service_failure$/.test(code))
    return `Facebook was busy or rate-limited while fetching ${what}. Try again later.`;
  return `${what[0].toUpperCase()}${what.slice(1)} could not be fetched from Facebook (${code || 'unknown error'}).`;
}
function providerFailure(code = '') {
  if (code === 'hibp_key_rejected')
    return 'The breach check failed: Have I Been Pwned rejected the configured API key.';
  if (/^hibp_/.test(code)) return `The breach check failed (${code}).`;
  if (code === 'llm_http_401') return 'OpenAI rejected the configured API key.';
  if (code === 'llm_http_404')
    return 'The configured OpenAI model is not available to this API key.';
  if (code === 'llm_http_429')
    return 'OpenAI refused the request because of a quota or rate limit.';
  if (/^llm_/.test(code)) return `The OpenAI request failed (${code}).`;
  return `This part failed (${code || 'unknown error'}). Other sections are unaffected.`;
}
function whyMissing(report, key) {
  const m = report.modules[key];
  if (!m) return null;
  const reason = m.diagnostics?.reason || '';
  if (m.status === 'failed' && key === 'image' && !m.error) {
    const codes = Object.keys(m.diagnostics?.failureCodes || {});
    const n = m.diagnostics?.attempted ?? 0;
    if (codes.some((c) => /photo_/.test(c)))
      return `None of ${plural(n, 'photo')} could be downloaded from Facebook's image servers (${codes.join(', ')}).`;
    if (codes.some((c) => /^vision:grpc_(7|16)$/.test(c)))
      return 'Google Vision refused the request; check the service-account credentials and that the Vision API is enabled.';
    return `All ${plural(n, 'photo')} failed to process (${codes.join(', ') || 'unknown error'}).`;
  }
  if (m.status === 'failed') return providerFailure(m.error);
  if (m.status !== 'unavailable') return null;
  const source = reason.match(/^(posts|likes|photos)_acquisition_failed$/);
  if (source) return sourceFailure(source[1], m.diagnostics?.code);
  return (
    {
      openai_not_consented: 'Not run, because you did not allow sending posts to OpenAI.',
      openai_not_configured: 'Not run, because no OpenAI API key is configured on this server.',
      hibp_not_consented: 'Your email was not checked for breaches because you did not consent.',
      hibp_not_configured:
        'Not run, because no Have I Been Pwned API key is configured on this server.',
      no_verified_email: 'Not run, because Facebook did not share a verified email address.',
      image_consent_not_given:
        'Photos were not analysed because you did not consent to image processing.',
    }[reason] || `Not run (${reason || 'unknown reason'}).`
  );
}

function overview(report) {
  const modules = Object.entries(report.modules).map(([key, m]) => ({
    name: MODULE_NAMES[key] || key,
    status: m.status,
    statusText: m.status === 'ok' ? STATUS_TEXT.ok : whyMissing(report, key),
  }));
  return { modules };
}

function timing(report) {
  const peak = feature(report, 'temporal.peakHours');
  if (!peak) {
    const n = report.modules.temporal?.diagnostics?.validN ?? 0;
    const minN = report.modules.temporal?.diagnostics?.minN ?? 10;
    return {
      available: false,
      message: `Not enough dated posts to describe when you post (${n} found, ${minN} needed).`,
    };
  }
  const histogram = feature(report, 'temporal.hourHistogram').value;
  const total = histogram.reduce((a, b) => a + b, 0);
  const circular = feature(report, 'temporal.circular')?.value;
  const weekly = feature(report, 'temporal.weekdayWeekend')?.value;
  const intervals = feature(report, 'temporal.intervals')?.value;
  const r = circular?.resultantLength ?? 0;
  const spread =
    r >= 0.7
      ? 'Your posting times are tightly clustered, which makes your routine easy to read.'
      : r >= 0.4
        ? 'Your posting times are moderately clustered around that hour.'
        : 'Your posting times are spread across the day, so no single routine stands out.';
  const sentences = [
    `Your most common posting hour is ${peak.value.map(hour).join(' and ')} (${report.metadata.timezone} time), across ${plural(total, 'dated post')}.`,
    spread,
  ];
  if (weekly) {
    sentences.push(
      `${pct(weekly.weekendPosts, total)}% of your posts were made at weekends (${weekly.weekendPosts} of ${total}).`
    );
  }
  if (intervals) {
    const median = intervals.median;
    sentences.push(
      `The typical gap between posts is ${median >= 48 ? `${Math.round(median / 24)} days` : `${Math.round(median)} hours`}.`
    );
  }
  const max = Math.max(...histogram, 1);
  return {
    available: true,
    sentences,
    bars: histogram.map((count, h) => ({
      hour: h,
      count,
      height: Math.round((count / max) * 100),
      peak: peak.value.includes(h),
    })),
    method: peak.method,
    n: peak.n,
    limitations: peak.limitations,
  };
}

function tone(report) {
  const s = feature(report, 'text.sentiment');
  if (!s) return { available: false, message: 'No post text was available to describe.' };
  const d = s.value.distribution;
  const scored = d.positive + d.neutral + d.negative;
  const sentences = scored
    ? [
        `Of the ${plural(scored, 'post')} we could score, ${d.positive} read as positive, ${d.neutral} as neutral and ${d.negative} as negative.`,
      ]
    : ['None of your posts could be scored for tone.'];
  if (d.unscored) {
    sentences.push(
      `${plural(d.unscored, 'post')} could not be scored, usually because they are not in English. They are not counted as neutral.`
    );
  }
  sentences.push(
    'This describes the wording of posts, not your mood or mental health. Sarcasm and achievements described without emotional words are often misread.'
  );
  const total = d.positive + d.neutral + d.negative + d.unscored;
  let x = 0;
  const segments = ['positive', 'neutral', 'negative', 'unscored'].map((label) => {
    const width = total ? (100 * d[label]) / total : 0;
    const seg = { label, count: d[label], x, width };
    x += width;
    return seg;
  });
  return {
    available: true,
    sentences,
    segments,
    method: s.method,
    n: s.n,
    limitations: s.limitations,
  };
}

function topics(report) {
  const t = feature(report, 'text.topics');
  const sources = report.sources?.posts || {};
  if (!t) {
    return {
      available: false,
      message: 'No topics from our list were found in your English posts.',
    };
  }
  const items = t.value.map((item) => ({
    name: topicName(item.topic),
    count: item.count,
    countText: plural(item.count, 'post'),
    examples: item.postIds
      .slice(0, 2)
      .map((id) => excerpt(sources[id]?.text))
      .filter(Boolean),
  }));
  return {
    available: true,
    sentences: [
      `Words in your posts match ${plural(items.length, 'topic')} in our list. The most frequent is ${items[0].name.toLowerCase()} (${plural(items[0].count, 'post')}).`,
    ],
    items,
    method: t.method,
    n: t.n,
    limitations: t.limitations,
  };
}

function interests(report) {
  const c = feature(report, 'interests.categories');
  const likes = report.sources?.likes || {};
  if (!c)
    return { available: false, message: 'No page likes were available or matched a category.' };
  const items = c.value.map((item) => ({
    name: topicName(item.topic),
    count: item.likeIds.length,
    pages: item.likeIds.map((id) => likes[id]?.name).filter(Boolean),
  }));
  const unmapped = report.modules.interests?.diagnostics?.unmapped ?? 0;
  const sentences = [
    `Your page likes fall into ${plural(items.length, 'category', 'categories')}. Advertisers can target interests like these directly.`,
  ];
  if (unmapped)
    sentences.push(`${plural(unmapped, 'like')} did not match any category in our list.`);
  return {
    available: true,
    sentences,
    items,
    method: c.method,
    n: c.n,
    limitations: c.limitations,
  };
}

function writing(report) {
  const out = [];
  const keywords = feature(report, 'text.keywords');
  if (keywords) {
    out.push({
      title: 'Words that stand out',
      sentences: ['These words are frequent in your posts but not common everywhere (TF-IDF).'],
      chips: keywords.value.slice(0, 12).map((k) => k.term),
    });
  }
  const languages = feature(report, 'text.languages');
  if (languages) {
    const perPost = languages.value.perPost;
    const tally = {};
    perPost.forEach((p) => p.language && (tally[p.language] = (tally[p.language] || 0) + 1));
    const counts = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    const inherited = perPost.filter((p) => p.source === 'profile_dominant_language').length;
    const undetected = perPost.filter((p) => !p.language).length;
    const sentences = [
      counts.length
        ? `Languages of your posts: ${counts.map(([l, n]) => `${LANGUAGE_NAMES[l] || l} (${n})`).join(', ')}.`
        : 'No language could be detected reliably.',
    ];
    if (inherited) {
      sentences.push(
        `${plural(inherited, 'post was', 'posts were')} too short to detect and took your most common language.`
      );
    }
    if (undetected) sentences.push(`${plural(undetected, 'post')} had no detectable language.`);
    out.push({ title: 'Languages', sentences });
  }
  const readability = feature(report, 'text.readability');
  if (readability) {
    const score = readability.value.fleschReadingEase;
    const band =
      score >= 80
        ? 'very easy'
        : score >= 60
          ? 'plain English'
          : score >= 50
            ? 'fairly difficult'
            : 'difficult';
    out.push({
      title: 'Reading ease',
      sentences: [
        `Your English posts score ${Math.round(score)} on the Flesch reading-ease scale (${band}), over ${readability.value.sentences} sentences. This is about sentence and word length; it says nothing about education.`,
      ],
    });
  }
  return out;
}

function photos(report) {
  const o = feature(report, 'image.observations');
  if (!o) {
    return { available: false, message: 'You have no photos available to analyse.' };
  }
  return {
    available: true,
    sentences: [
      `${plural(o.value.length, 'photo')} analysed. These are the things a vision service reports seeing, and the text it reads.`,
    ],
    items: o.value.map((p) => ({
      labels: [...p.labels, ...p.objects, ...p.logos, ...p.landmarks].map((l) => l.label),
      text: excerpt(p.text, 80),
      method: p.method === 'google_vision' ? 'Google Cloud Vision' : 'Local OCR',
    })),
    method: o.method,
    n: o.n,
    limitations: o.limitations,
  };
}

function guesses(report) {
  const g = feature(report, 'inference.guesses');
  const diagnostics = report.modules.inference?.diagnostics || {};
  if (!g) {
    return {
      available: false,
      message:
        'The AI model made no guesses that could be backed by an exact quote from your posts.',
    };
  }
  return {
    available: true,
    sentences: [
      'An AI model read your posts and guessed the attributes below. Each guess is shown only if it quotes your post word for word. A quote proves the text exists, not that the guess is right.',
      diagnostics.rejected
        ? `${plural(diagnostics.rejected, 'other guess was', 'other guesses were')} discarded because the quoted evidence did not appear in your posts.`
        : null,
    ].filter(Boolean),
    items: g.value
      .map((item, index) => ({
        index,
        attribute: item.attribute.replace('_', ' '),
        guess: item.guess,
        certainty: item.certainty,
        quotes: item.evidence.map((e) => e.quote),
      }))
      .filter((item) => meaningfulGuess(item.guess, item.attribute.replace(' ', '_'))),
  };
}

function breaches(report) {
  const b = feature(report, 'osint.breaches');
  if (!b) {
    return { available: false, message: 'No breach information is available.' };
  }
  return {
    available: true,
    sentences: b.value.length
      ? [
          `Your account email appears in ${plural(b.value.length, 'known data breach', 'known data breaches')} listed by Have I Been Pwned. If you reused a password from these services, change it.`,
        ]
      : [
          'Your account email does not appear in Have I Been Pwned. That does not prove it was never exposed.',
        ],
    items: b.value.map((x) => ({
      name: x.name,
      date: x.date,
      dataClasses: x.dataClasses.join(', '),
    })),
  };
}

function explanations(report) {
  const e = report.explanations || {};
  if (e.status !== 'ok') return { available: false };
  // Nothing attempted because every section's request failed: say why, not "0 of 0 removed".
  if (!e.attempted && e.sectionFailures?.length) {
    const code = Object.values(e.sectionFailureCodes || {})[0];
    return {
      available: true,
      failed: true,
      message: `The AI summary could not be written. ${providerFailure(code)}`,
    };
  }
  return {
    available: true,
    sentences: e.sentences.map((s) => s.text),
    checked: e.attempted,
    dropped: e.flagged,
  };
}

function present(report) {
  // A module that did not run (or failed) shows its real reason instead of "no data".
  const section = (key, build) => {
    const why = whyMissing(report, key);
    if (!why) return build(report);
    const m = report.modules[key];
    const failed =
      m?.status === 'failed' || /_acquisition_failed$/.test(m?.diagnostics?.reason || '');
    return { available: false, message: why, failed };
  };
  return {
    overview: overview(report),
    timing: section('temporal', timing),
    tone: section('text', tone),
    topics: section('text', topics),
    interests: section('interests', interests),
    writing: whyMissing(report, 'text') ? [] : writing(report),
    photos: section('image', photos),
    guesses: section('inference', guesses),
    breaches: section('osint', breaches),
    explanations: explanations(report),
  };
}

module.exports = { present, whyMissing, TOPIC_NAMES };
