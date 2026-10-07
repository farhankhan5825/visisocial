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
const { tree, watchers } = require('../report/pages');
const { consoleView } = require('../report/console');
const { log } = require('../privacy/logger');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function routes(options) {
  const { store, cache, queue, demo, env = process.env } = options,
    router = express.Router();
  const auth = wrap(async (req, res, next) => {
    if (!req.session.owner) return res.redirect('/');
    const r = await store.get(req.session.owner);
    if (!r) {
      await new Promise((resolve) => req.session.destroy(resolve));
      return res.redirect('/');
    }
    req.record = r;
    next();
  });
  const page = (res, status, heading, body, extra = {}) =>
    res.status(status).render('message', { heading, body, ...extra });
  router.get('/', (_req, res) => res.render('home'));
  for (const [route, view] of [
    ['/how-it-works', 'how-it-works'],
    ['/about', 'about'],
    ['/privacy', 'privacy'],
    ['/terms', 'terms'],
  ])
    router.get(route, (_req, res) => res.render(view));
  router.get('/health', (_req, res) =>
    res.json({ status: 'ok', mode: demo ? 'offline_synthetic' : 'live_test_users' })
  );
  router.post(
    '/demo',
    wrap(async (req, res) => {
      if (!demo) return res.sendStatus(404);
      await new Promise((resolve, reject) =>
        req.session.regenerate((err) => (err ? reject(err) : resolve()))
      );
      req.session.owner = randomUUID();
      req.session.csrf = randomBytes(32).toString('hex');
      const fixture = JSON.parse(
        fs.readFileSync(path.join(__dirname, '../../eval/profiles/p01.json'), 'utf8')
      );
      await store.put(req.session.owner, {
        identity: { id: fixture.id, name: fixture.name, email: fixture.email },
        status: 'awaiting_consent',
      });
      res.redirect('/consent');
    })
  );
  router.get(
    '/auth/facebook',
    wrap(async (req, res) => {
      if (demo) return res.sendStatus(404);
      req.session.oauthState = randomBytes(32).toString('hex');
      const u = new URL(`https://www.facebook.com/${env.API_VERSION}/dialog/oauth`);
      u.search = new URLSearchParams({
        client_id: env.FACEBOOK_APP_ID,
        redirect_uri: `${options.origin}/auth/facebook/callback`,
        state: req.session.oauthState,
        scope: 'email,public_profile,user_posts,user_likes,user_photos',
      });
      res.redirect(u.href);
    })
  );
  router.get(
    '/auth/facebook/callback',
    wrap(async (req, res) => {
      if (demo) return res.sendStatus(404);
      const state = req.query.state,
        expected = req.session.oauthState;
      delete req.session.oauthState;
      if (
        typeof state !== 'string' ||
        typeof expected !== 'string' ||
        Buffer.byteLength(state) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(state), Buffer.from(expected)) ||
        typeof req.query.code !== 'string'
      )
        return page(
          res,
          403,
          'Sign-in did not complete',
          'The sign-in link expired or was opened in a different browser. Start again from the home page.',
          {
            icon: 'fa-rotate',
            tone: 'warn',
            action: { href: '/', label: 'Start again' },
          }
        );
      const response = await fetch(
        `https://graph.facebook.com/${env.API_VERSION}/oauth/access_token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: env.FACEBOOK_APP_ID,
            client_secret: env.FACEBOOK_APP_SECRET,
            redirect_uri: `${options.origin}/auth/facebook/callback`,
            code: req.query.code,
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
        }
      );
      if (!response.ok) throw new Error('oauth_exchange_failed');
      const token = (await response.json()).access_token;
      if (typeof token !== 'string') throw new Error('missing_oauth_token');
      const graph = createFacebook({ token, version: env.API_VERSION });
      const identity = await graph.request('me', { fields: 'id,name,email' });
      if (
        !env.FACEBOOK_TEST_USER_IDS.split(',')
          .map((s) => s.trim())
          .includes(identity.id)
      )
        return page(
          res,
          403,
          'This account is not allowed yet',
          'VisiSocial runs only for the Facebook test accounts listed in FACEBOOK_TEST_USER_IDS. Add this account to that list in .env and restart the server.',
          {
            icon: 'fa-user-lock',
            tone: 'warn',
            action: { href: '/', label: 'Back' },
          }
        );
      let existing = await store.findByIdentity(identity.id);
      if (existing) await queue.pending.get(existing.owner)?.catch(() => {});
      existing = await store.findByIdentity(identity.id);
      await new Promise((resolve, reject) =>
        req.session.regenerate((err) => (err ? reject(err) : resolve()))
      );
      req.session.owner = existing?.owner || randomUUID();
      req.session.csrf = randomBytes(32).toString('hex');
      await store.put(req.session.owner, {
        ...existing,
        identity: {
          id: identity.id,
          name: identity.name,
          ...(identity.email ? { email: identity.email } : {}),
        },
        token: encryptToken(token, req.session.owner, options.tokenKey),
        status: existing?.status || 'awaiting_consent',
      });
      res.redirect('/consent');
    })
  );
  router.get('/consent', auth, (req, res) =>
    res.render('consent', { identity: req.record.identity })
  );
  router.post(
    '/analyze',
    auth,
    wrap(async (req, res) => {
      const timezone = typeof req.body.timezone === 'string' ? req.body.timezone : 'UTC';
      try {
        new Intl.DateTimeFormat('en', { timeZone: timezone });
      } catch {
        return page(
          res,
          400,
          'Check your timezone',
          'Enter a valid IANA timezone name, such as Europe/London or Asia/Karachi.',
          {
            icon: 'fa-clock',
            tone: 'warn',
            action: { href: '/consent', label: 'Back to choices' },
          }
        );
      }
      const consent = Object.fromEntries(
        ['openai', 'vision', 'localOcr', 'hibp', 'sensitive', 'personality'].map((k) => [
          k,
          req.body[k] === 'on',
        ])
      );
      if ((consent.sensitive || consent.personality) && !consent.openai)
        return page(
          res,
          400,
          'One more choice needed',
          'Personality, age-range and relationship guesses use OpenAI, so they need the OpenAI option too.',
          {
            icon: 'fa-sliders',
            tone: 'warn',
            action: { href: '/consent', label: 'Back to choices' },
          }
        );
      const owner = req.session.owner;
      if (queue.active(owner)) return res.redirect('/loading');
      // Revoking consent removes prior cached/report material before a new run.
      cache.deleteOwner(owner);
      const record = {
        identity: req.record.identity,
        ...(req.record.token ? { token: req.record.token } : {}),
        consent,
        timezone,
        status: 'processing',
      };
      await store.put(owner, record);
      queue
        .add(owner, async (isDeleted) => {
          try {
            let ingest, providers;
            if (demo) {
              const fixture = JSON.parse(
                fs.readFileSync(path.join(__dirname, '../../eval/profiles/p01.json'), 'utf8')
              );
              ingest = async () => ({ ...fixture, timezone });
              providers = require('../../eval/mock-providers').mockProviders(fixture.id);
            } else {
              let token;
              try {
                token = decryptToken(record.token, owner, options.tokenKey);
              } catch {
                throw new Error('token_unreadable');
              }
              const graph = createFacebook({ token, version: env.API_VERSION });
              ingest = () => graph.ingest(timezone, record.identity.id);
              providers = options.providers;
            }
            const pipeline = createModules(providers, record.identity);
            const result = await runPipeline({
              ingest,
              ...pipeline,
              cache,
              owner,
              consent,
              context: {
                ...promptMetadata(),
                mode: demo ? 'authored_mock_providers' : 'live_services',
                graphVersion: demo ? 'offline_graph_shape' : env.API_VERSION,
              },
            });
            if (!isDeleted())
              await store.put(owner, { ...record, status: 'complete', report: result.report });
          } catch (err) {
            // Keep only our own error codes (never provider text) so the user can be told why.
            const failure = /^[a-z][a-z0-9_]{2,60}$/.test(err?.message || '')
              ? err.message
              : 'unexpected_error';
            if (!isDeleted()) await store.put(owner, { ...record, status: 'failed', failure });
            log('analysis_failed');
          }
        })
        .catch(() => log('queue_failed'));
      res.redirect('/loading');
    })
  );
  const FAILURES = {
    identity_mismatch:
      'The Facebook account changed since you signed in. Log out and connect again.',
    graph_request_failed_190: 'Your Facebook login has expired. Log out and connect again.',
    token_unreadable:
      'Your saved login can no longer be read because the server key changed. Log out and connect again.',
  };
  router.get('/loading', auth, (req, res) => {
    if (req.record.status === 'complete') return res.redirect('/dashboard');
    if (req.record.status === 'failed')
      return page(
        res,
        503,
        'The analysis could not finish',
        FAILURES[req.record.failure] ||
          `Your data could not be read (${req.record.failure || 'unknown error'}). Try again; if it keeps failing, log out and connect again.`,
        {
          icon: 'fa-triangle-exclamation',
          tone: 'alert',
          action: { href: '/consent', label: 'Try again' },
        }
      );
    res.render('loading');
  });
  const withReport = (render) => (req, res) => {
    if (!req.record.report)
      return res.redirect(req.record.status === 'processing' ? '/loading' : '/consent');
    render(req, res, req.record.report);
  };
  const showDashboard = withReport((req, res, report) =>
    res.render('dashboard', {
      report,
      identity: req.record.identity,
      consoleData: consoleView(report, req.record.identity),
    })
  );
  router.get('/dashboard', auth, showDashboard);
  router.get('/report', auth, showDashboard);
  // The evidence trail lives inside the console: select a finding to trace it.
  router.get('/evidence', auth, showDashboard);
  router.get(
    '/layers',
    auth,
    withReport((req, res, report) =>
      res.render('layers', { tree: tree(report, req.record.identity) })
    )
  );
  router.get(
    '/watchers',
    auth,
    withReport((req, res, report) => res.render('watchers', { watchers: watchers(report) }))
  );
  router.get('/my-data', auth, (req, res) =>
    res.render('my-data', { identity: req.record.identity, report: req.record.report || null })
  );
  router.get('/export', auth, (req, res) => {
    if (!req.record.report) return res.sendStatus(404);
    res.set('Content-Disposition', 'attachment; filename="visisocial-report.json"');
    res.json(req.record.report);
  });
  router.post(
    '/feedback',
    auth,
    wrap(async (req, res) => {
      const index = Number(req.body.index),
        guesses = req.record.report?.features['inference.guesses']?.value;
      if (!Array.isArray(guesses) || !Number.isInteger(index) || !guesses[index])
        return page(
          res,
          400,
          'That finding no longer exists',
          'Your report changed since this page loaded.',
          {
            action: { href: '/dashboard', label: 'Back to dashboard' },
          }
        );
      await store.feedback(req.session.owner, {
        attribute: guesses[index].attribute,
        guess: guesses[index].guess,
        incorrect: true,
        at: new Date().toISOString(),
      });
      // Return to the page the button was on (path only, never an outside URL).
      let back = '/dashboard';
      try {
        const from = new URL(req.get('referer') || '', 'http://local');
        if (['/dashboard', '/evidence', '/report'].includes(from.pathname)) back = from.pathname;
      } catch {
        /* keep default */
      }
      res.redirect(back);
    })
  );
  router.post(
    '/delete',
    auth,
    wrap(async (req, res) => {
      const owner = req.session.owner;
      await deleteOwner(owner, {
        store,
        cache,
        queue,
        sessions: options.deleteSessions || (async () => {}),
      });
      await new Promise((resolve, reject) =>
        req.session.destroy((err) => (err ? reject(err) : resolve()))
      );
      res.clearCookie('visisocial.sid');
      res.locals.signedIn = false;
      page(
        res,
        200,
        'Your data has been deleted',
        'Your record, encrypted login token, report, feedback, cache and sessions are gone from this server. Copies you downloaded, and data already sent to OpenAI, Google, Meta or Have I Been Pwned, are outside this deletion.',
        {
          icon: 'fa-check',
          tone: 'ok',
          action: { href: '/', label: 'Done' },
        }
      );
    })
  );
  router.post(
    '/logout',
    wrap(async (req, res) => {
      await new Promise((resolve) => req.session.destroy(resolve));
      res.clearCookie('visisocial.sid');
      res.redirect('/');
    })
  );
  return router;
}
module.exports = { routes };
