'use strict';
const { profile } = require('../schemas');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Only our own snake_case error codes are kept for diagnostics; anything else is generic.
const safeCode = (err) =>
  /^[a-z][a-z0-9_]{2,60}$/.test(err?.message || '') ? err.message : 'unexpected_error';
function createFacebook({ token, version, fetchImpl = fetch, wait = pause }) {
  if (!/^v\d+\.0$/.test(version || '')) throw new Error('graph_version_required');
  async function request(endpoint, params = {}) {
    if (!/^(me|me\/(posts|likes|photos))$/.test(endpoint))
      throw new Error('invalid_graph_endpoint');
    const url = new URL(`https://graph.facebook.com/${version}/${endpoint}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 2) throw new Error('graph_rate_or_service_failure');
        const seconds = Number(response.headers.get('retry-after'));
        await wait(
          Number.isFinite(seconds) && seconds > 0
            ? Math.min(seconds * 1000, 60000)
            : 250 * 2 ** attempt
        );
        continue;
      }
      const body = await response.json().catch(() => ({}));
      // Keep Graph's numeric error code (e.g. 200 = missing permission); never its message.
      const code = Number.isInteger(body?.error?.code) ? `_${body.error.code}` : '';
      if (!response.ok || body.error) throw new Error(`graph_request_failed${code}`);
      return body;
    }
  }
  // Graph uses cursor paging (likes, photos: paging.cursors.after) and time-based paging
  // (posts: until/since/__paging_token carried only in paging.next). The next URL is never
  // fetched directly: it must point at graph.facebook.com, the same version and the same
  // edge, and only these paging parameters are copied from it. The token is never read
  // from it.
  const PAGING_PARAMS = ['after', 'until', 'since', '__paging_token'];
  function nextPage(paging, name) {
    if (!paging?.next) return null;
    if (paging.cursors?.after) return { after: paging.cursors.after };
    let next;
    try {
      next = new URL(paging.next);
    } catch {
      throw new Error('invalid_graph_next_url');
    }
    const parts = next.pathname.split('/').filter(Boolean);
    if (
      next.protocol !== 'https:' ||
      next.hostname !== 'graph.facebook.com' ||
      parts.length !== 3 ||
      parts[0] !== version ||
      parts[2] !== name
    )
      throw new Error('invalid_graph_next_url');
    const params = Object.fromEntries(
      PAGING_PARAMS.filter((k) => next.searchParams.has(k)).map((k) => [
        k,
        next.searchParams.get(k),
      ])
    );
    if (!Object.keys(params).length) throw new Error('invalid_graph_next_url');
    return params;
  }
  async function edge(name, fields) {
    const data = [],
      seen = new Set();
    let paging = {};
    for (let page = 0; page < 100; page++) {
      const response = await request(`me/${name}`, {
        fields,
        limit: 100,
        ...(name === 'photos' ? { type: 'uploaded' } : {}),
        ...paging,
      });
      if (!Array.isArray(response.data)) throw new Error('invalid_graph_page');
      data.push(...response.data);
      const next = response.data.length ? nextPage(response.paging, name) : null;
      if (!next) return { data };
      const key = JSON.stringify(next);
      if (seen.has(key)) throw new Error('repeated_graph_page');
      seen.add(key);
      paging = next;
    }
    throw new Error('graph_page_limit_reached');
  }
  async function ingest(timezone, expectedId) {
    const identity = await request('me', { fields: 'id,name,email' });
    if (expectedId && identity.id !== expectedId) throw new Error('identity_mismatch');
    const acquisitionErrors = [],
      acquisitionCodes = {};
    const edges = await Promise.all(
      [
        ['posts', 'id,message,story,created_time'],
        ['likes', 'id,name,category'],
        ['photos', 'id,images,picture'],
      ].map(async ([name, fields]) => {
        try {
          return [name, await edge(name, fields)];
        } catch (err) {
          acquisitionErrors.push(name);
          acquisitionCodes[name] = safeCode(err);
          return [name, { data: [] }];
        }
      })
    );
    return {
      ...profile.parse({ ...identity, timezone, ...Object.fromEntries(edges) }),
      acquisitionErrors,
      acquisitionCodes,
    };
  }
  return { request, edge, ingest };
}
module.exports = { createFacebook, safeCode };
