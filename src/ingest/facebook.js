'use strict';
const { profile } = require('../schemas');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function createFacebook({ token, version, fetchImpl = fetch, wait = pause }) {
  if (!/^v\d+\.0$/.test(version || '')) throw new Error('graph_version_required');
  async function request(endpoint, params = {}) {
    if (!/^(me|me\/(posts|likes|photos))$/.test(endpoint)) throw new Error('invalid_graph_endpoint');
    const url = new URL(`https://graph.facebook.com/${version}/${endpoint}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (response.status === 429 || response.status >= 500) { if (attempt === 2) throw new Error('graph_rate_or_service_failure'); const seconds = Number(response.headers.get('retry-after')); await wait(Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 60000) : 250 * 2 ** attempt); continue; }
      if (!response.ok) throw new Error('graph_request_failed');
      const body = await response.json(); if (body.error) throw new Error('graph_response_error'); return body;
    }
  }
  async function edge(name, fields) {
    const data = [], seen = new Set(); let after;
    for (let page = 0; page < 100; page++) {
      const response = await request(`me/${name}`, { fields, limit: 100, ...(name === 'photos' ? { type: 'uploaded' } : {}), ...(after ? { after } : {}) });
      if (!Array.isArray(response.data)) throw new Error('invalid_graph_page');
      data.push(...response.data);
      if (!response.paging?.next) return { data };
      after = response.paging?.cursors?.after;
      if (!after || seen.has(after)) throw new Error('invalid_or_repeated_graph_cursor'); seen.add(after);
    }
    throw new Error('graph_page_limit_reached');
  }
  async function ingest(timezone, expectedId) {
    const identity = await request('me', { fields: 'id,name,email' });
    if (expectedId && identity.id !== expectedId) throw new Error('identity_mismatch');
    const acquisitionErrors = [];
    const edges = await Promise.all([['posts', 'id,message,story,created_time'], ['likes', 'id,name,category'], ['photos', 'id,images,picture']].map(async ([name, fields]) => { try { return [name, await edge(name, fields)]; } catch { acquisitionErrors.push(name); return [name, { data: [] }]; } }));
    return { ...profile.parse({ ...identity, timezone, ...Object.fromEntries(edges) }), acquisitionErrors };
  }
  return { request, edge, ingest };
}
module.exports = { createFacebook };
