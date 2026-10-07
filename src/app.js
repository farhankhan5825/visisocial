'use strict';
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const path = require('node:path');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { routes } = require('./routes');
const { log } = require('./privacy/logger');
function createApp(options) {
  const app = express();
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  if (options.production) app.set('trust proxy', 1);
  // Template defaults so error pages render even before the session middleware runs.
  Object.assign(app.locals, { demo: Boolean(options.demo), path: '', signedIn: false, csrf: '' });
  // Cache-busting: asset URLs carry a hash of the files, so updates are never served stale.
  const { createHash } = require('node:crypto');
  const fs = require('node:fs');
  app.locals.v = createHash('sha256')
    .update(
      ['app.css', 'app.js'].map((f) => fs.readFileSync(path.join(__dirname, 'assets', f))).join('')
    )
    .digest('hex')
    .slice(0, 10);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Same-origin scripts only (app.js, vendored Chart.js); no inline code anywhere.
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    })
  );
  // Static assets first: they need no session, CSRF token or rate-limit budget.
  app.use(
    '/assets',
    express.static(path.join(__dirname, 'assets'), { dotfiles: 'deny', index: false, maxAge: '1h' })
  );
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use(express.json({ limit: '16kb' }));
  app.use(
    rateLimit({ windowMs: 60000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false })
  );
  app.use(
    session({
      name: 'visisocial.sid',
      secret: options.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: options.sessionStore,
      cookie: { httpOnly: true, secure: options.production, sameSite: 'lax', maxAge: 3600000 },
    })
  );
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    req.session.csrf ||= randomBytes(32).toString('hex');
    res.locals.csrf = req.session.csrf;
    res.locals.demo = options.demo;
    res.locals.path = req.path;
    res.locals.signedIn = Boolean(req.session.owner);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const raw = req.body?._csrf || req.headers['x-csrf-token'];
      if (
        typeof raw !== 'string' ||
        Buffer.byteLength(raw) !== Buffer.byteLength(req.session.csrf) ||
        !timingSafeEqual(Buffer.from(raw), Buffer.from(req.session.csrf))
      )
        return res.status(403).render('message', {
          heading: 'Please try again',
          body: 'This form expired or came from another page. Reload the page and try again.',
          icon: 'fa-rotate',
          tone: 'warn',
          action: { href: '/', label: 'Start again' },
        });
    }
    next();
  });
  app.use(routes(options));
  app.use((_req, res) =>
    res.status(404).render('message', {
      heading: 'Page not found',
      body: 'That page does not exist.',
      icon: 'fa-compass',
      action: { href: '/', label: 'Go home' },
    })
  );
  app.use((err, _req, res, _next) => {
    log('request_failed');
    res.status(500).render('message', {
      heading: 'Something went wrong',
      body: 'The request could not be completed. No personal details were logged.',
      icon: 'fa-triangle-exclamation',
      tone: 'alert',
      action: { href: '/', label: 'Go home' },
    });
  });
  return app;
}
module.exports = { createApp };
