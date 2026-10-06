'use strict';
const express = require('express');
const { randomUUID, randomBytes, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createFacebook } = require('../ingest/facebook');
const { encryptToken, decryptToken } = require('../privacy/tokens');
const { deleteOwner } = require('../privacy/store');
const { runPipeline } = require('../pipeline');
const { createModules } = require('../modules');
const { promptMetadata } = require('../providers');
const { log } = require('../privacy/logger');
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function routes(options) {
  const { store, cache, queue, demo, env = process.env } = options, router = express.Router();
  const auth = wrap(async (req, res, next) => { if (!req.session.owner) return res.redirect('/'); const r = await store.get(req.session.owner); if (!r) { await new Promise(resolve => req.session.destroy(resolve)); return res.redirect('/'); } req.record = r; next(); });
  router.get('/', (_req, res) => res.render('home'));
  router.get('/health', (_req, res) => res.json({ status: 'ok', mode: demo ? 'offline_synthetic' : 'live_test_users' }));
  router.post('/demo', wrap(async (req, res) => {
    if (!demo) return res.sendStatus(404);
    await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
    req.session.owner = randomUUID(); req.session.csrf = randomBytes(32).toString('hex');
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../../eval/profiles/p01.json'), 'utf8'));
    await store.put(req.session.owner, { identity: { id: fixture.id, name: fixture.name, email: fixture.email }, status: 'awaiting_consent' });
    res.redirect('/consent');
  }));
  router.get('/auth/facebook', wrap(async (req, res) => {
    if (demo) return res.sendStatus(404);
    req.session.oauthState = randomBytes(32).toString('hex');
    const u = new URL(`https://www.facebook.com/${env.API_VERSION}/dialog/oauth`);
    u.search = new URLSearchParams({ client_id: env.FACEBOOK_APP_ID, redirect_uri: `${options.origin}/auth/facebook/callback`, state: req.session.oauthState, scope: 'email,public_profile,user_posts,user_likes,user_photos' });
    res.redirect(u.href);
  }));
  router.get('/auth/facebook/callback', wrap(async (req, res) => {
    if (demo) return res.sendStatus(404);
    const state = req.query.state, expected = req.session.oauthState; delete req.session.oauthState;
    if (typeof state !== 'string' || typeof expected !== 'string' || Buffer.byteLength(state) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(state), Buffer.from(expected)) || typeof req.query.code !== 'string') return res.status(403).send('OAuth state invalid.');
    const response = await fetch(`https://graph.facebook.com/${env.API_VERSION}/oauth/access_token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.FACEBOOK_APP_ID, client_secret: env.FACEBOOK_APP_SECRET, redirect_uri: `${options.origin}/auth/facebook/callback`, code: req.query.code }), redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('oauth_exchange_failed');
    const token = (await response.json()).access_token; if (typeof token !== 'string') throw new Error('missing_oauth_token');
    const graph = createFacebook({ token, version: env.API_VERSION }); const identity = await graph.request('me', { fields: 'id,name,email' });
    if (!env.FACEBOOK_TEST_USER_IDS.split(',').map(s => s.trim()).includes(identity.id)) return res.status(403).send('Only explicitly configured developer test users are permitted.');
    let existing = await store.findByIdentity(identity.id);
    if (existing) await queue.pending.get(existing.owner)?.catch(() => {});
    existing = await store.findByIdentity(identity.id);
    await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
    req.session.owner = existing?.owner || randomUUID(); req.session.csrf = randomBytes(32).toString('hex');
    await store.put(req.session.owner, { ...existing, identity: { id: identity.id, name: identity.name, ...(identity.email ? { email: identity.email } : {}) }, token: encryptToken(token, req.session.owner, options.tokenKey), status: existing?.status || 'awaiting_consent' });
    res.redirect('/consent');
  }));
  router.get('/consent', auth, (req, res) => res.render('consent', { identity: req.record.identity }));
  router.post('/analyze', auth, wrap(async (req, res) => {
    const timezone = typeof req.body.timezone === 'string' ? req.body.timezone : 'UTC';
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { return res.status(400).send('Enter a valid IANA timezone, such as Europe/London.'); }
    const consent = Object.fromEntries(['openai', 'vision', 'localOcr', 'hibp', 'sensitive'].map(k => [k, req.body[k] === 'on']));
    if (consent.sensitive && !consent.openai) return res.status(400).send('Sensitive guesses require the OpenAI option.');
    const owner = req.session.owner;
    if (queue.active(owner)) return res.redirect('/loading');
    // Revoking consent removes prior cached/report material before a new run.
    cache.deleteOwner(owner);
    const record = { identity: req.record.identity, ...(req.record.token ? { token: req.record.token } : {}), consent, timezone, status: 'processing' };
    await store.put(owner, record);
    queue.add(owner, async isDeleted => {
      try {
        let ingest, providers;
        if (demo) {
          const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../../eval/profiles/p01.json'), 'utf8'));
          ingest = async () => ({ ...fixture, timezone }); providers = require('../../eval/mock-providers').mockProviders(fixture.id);
        } else {
          const token = decryptToken(record.token, owner, options.tokenKey), graph = createFacebook({ token, version: env.API_VERSION });
          ingest = () => graph.ingest(timezone, record.identity.id); providers = options.providers;
        }
        const pipeline = createModules(providers, record.identity);
        const result = await runPipeline({ ingest, ...pipeline, cache, owner, consent, context: { ...promptMetadata(), mode: demo ? 'authored_mock_providers' : 'live_services', graphVersion: demo ? 'offline_graph_shape' : env.API_VERSION } });
        if (!isDeleted()) await store.put(owner, { ...record, status: 'complete', report: result.report });
      } catch { if (!isDeleted()) await store.put(owner, { ...record, status: 'failed' }); log('analysis_failed'); }
    }).catch(() => log('queue_failed'));
    res.redirect('/loading');
  }));
  router.get('/loading', auth, (req, res) => { if (req.record.status === 'complete') return res.redirect('/report'); if (req.record.status === 'failed') return res.status(503).send('Analysis failed. Return to /consent to retry.'); res.render('loading'); });
  router.get('/report', auth, (req, res) => { if (!req.record.report) return res.redirect('/consent'); res.render('report', { report: req.record.report, identity: req.record.identity }); });
  router.get('/export', auth, (req, res) => { if (!req.record.report) return res.sendStatus(404); res.set('Content-Disposition', 'attachment; filename="visisocial-report.json"'); res.json(req.record.report); });
  router.post('/feedback', auth, wrap(async (req, res) => {
    const index = Number(req.body.index), guesses = req.record.report?.features['inference.guesses']?.value;
    if (!Array.isArray(guesses) || !Number.isInteger(index) || !guesses[index]) return res.status(400).send('Invalid finding.');
    await store.feedback(req.session.owner, { attribute: guesses[index].attribute, guess: guesses[index].guess, incorrect: true, at: new Date().toISOString() }); res.redirect('/report');
  }));
  router.post('/delete', auth, wrap(async (req, res) => {
    const owner = req.session.owner;
    await deleteOwner(owner, { store, cache, queue, sessions: options.deleteSessions || (async () => {}) });
    await new Promise((resolve, reject) => req.session.destroy(err => err ? reject(err) : resolve()));
    res.clearCookie('visisocial.sid'); res.send('Your local record, encrypted token, report, feedback, cache and sessions have been removed. Exports were streamed without server files. Copies you downloaded and data already sent to OpenAI, Google, Meta or HIBP are outside this deletion.');
  }));
  router.post('/logout', wrap(async (req, res) => { await new Promise(resolve => req.session.destroy(resolve)); res.clearCookie('visisocial.sid'); res.redirect('/'); }));
  return router;
}
module.exports = { routes };
