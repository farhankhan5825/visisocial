'use strict';
const { finding } = require('../report/feature');
function localParts(time, timezone) {
  // The Graph API emits offsets without a colon ("+0000"); ISO 8601 allows both forms.
  const iso = (time || '').replace(/([+-]\d\d)(\d\d)$/, '$1:$2');
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(iso)) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekend: ['Sat', 'Sun'].includes(get('weekday')),
    ms: date.getTime(),
  };
}
function circular(hours) {
  if (!hours.length) return { meanHour: null, resultantLength: null };
  const x = hours.reduce((s, h) => s + Math.cos((h * Math.PI) / 12), 0) / hours.length;
  const y = hours.reduce((s, h) => s + Math.sin((h * Math.PI) / 12), 0) / hours.length;
  const r = Math.hypot(x, y);
  let mean = ((Math.atan2(y, x) * 12) / Math.PI + 24) % 24;
  if (Math.abs(mean - 24) < 1e-10) mean = 0;
  return { meanHour: r < 1e-10 ? null : mean, resultantLength: r };
}
function entropy(counts) {
  const n = counts.reduce((a, b) => a + b, 0);
  if (!n) return null;
  const occupied = counts.filter(Boolean),
    plugin = Math.max(0, -occupied.reduce((a, c) => a + (c / n) * Math.log2(c / n), 0));
  const correction = (occupied.length - 1) / (2 * n * Math.LN2);
  return {
    bits: plugin,
    millerMadowBits: plugin + correction,
    normalized:
      n <= 1 ? 0 : Math.min(1, (plugin + correction) / Math.log2(Math.min(counts.length, n))),
    n,
    occupiedBins: occupied.length,
  };
}
function intervalStats(ms) {
  const times = [...ms].sort((a, b) => a - b),
    gaps = times
      .slice(1)
      .map((t, i) => (t - times[i]) / 3600000)
      .sort((a, b) => a - b);
  if (!gaps.length) return null;
  const mid = Math.floor(gaps.length / 2);
  return {
    unit: 'hours',
    count: gaps.length,
    min: gaps[0],
    max: gaps.at(-1),
    mean: gaps.reduce((a, b) => a + b, 0) / gaps.length,
    median: gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2,
  };
}
function analyzeTemporal(profile, minN = 10) {
  // Invalid IANA timezone fails the module rather than silently selecting server time.
  new Intl.DateTimeFormat('en', { timeZone: profile.timezone });
  const observations = profile.posts.data.flatMap((p) => {
    const value = localParts(p.created_time, profile.timezone);
    return value ? [{ id: p.id, ...value }] : [];
  });
  const ids = observations.map((p) => p.id),
    enough = observations.length >= minN;
  const bins = Array(24).fill(0);
  observations.forEach((p) => bins[p.hour]++);
  const weekdays = observations.filter((p) => !p.weekend).length,
    weekends = observations.length - weekdays;
  const limits = [
    `At least ${minN} valid timezone-qualified timestamps required. Describes observed posts, not daily routines or vulnerability.`,
    `${profile.posts.data.length - observations.length} posts lack valid timestamps. Timezone: ${profile.timezone}.`,
  ];
  const make = (value, method) => finding(enough ? value : null, method, ids, limits);
  return {
    status: 'ok',
    features: {
      circular: make(
        circular(observations.map((p) => p.hour + p.minute / 60)),
        'user_local_circular_hour_statistics'
      ),
      peakHours: make(
        bins.flatMap((n, h) => (n === Math.max(...bins) ? [h] : [])),
        'user_local_hour_histogram_modes'
      ),
      hourHistogram: make(bins, 'user_local_24_hour_histogram'),
      entropy: make(entropy(bins), 'miller_madow_hour_entropy'),
      intervals: make(
        intervalStats(observations.map((p) => p.ms)),
        'sorted_utc_inter_post_intervals'
      ),
      weekdayWeekend: make(
        {
          weekdayPosts: weekdays,
          weekendPosts: weekends,
          ratio: weekends ? weekdays / weekends : null,
        },
        'weekday_to_weekend_post_count_ratio'
      ),
    },
    diagnostics: { validN: observations.length, minN, timezone: profile.timezone },
  };
}
module.exports = { analyzeTemporal, localParts, circular, entropy, intervalStats };
