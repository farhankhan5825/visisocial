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
  const app = express(); app.disable('x-powered-by');
  app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, 'views'));
  if (options.production) app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'none'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], formAction: ["'self'"], frameAncestors: ["'none'"] } } }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' })); app.use(express.json({ limit: '16kb' }));
  app.use(rateLimit({ windowMs: 60000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use(session({ name: 'visisocial.sid', secret: options.sessionSecret, resave: false, saveUninitialized: false, store: options.sessionStore, cookie: { httpOnly: true, secure: options.production, sameSite: 'lax', maxAge: 3600000 } }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    req.session.csrf ||= randomBytes(32).toString('hex'); res.locals.csrf = req.session.csrf; res.locals.demo = options.demo;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const raw = req.body?._csrf || req.headers['x-csrf-token'];
      if (typeof raw !== 'string' || Buffer.byteLength(raw) !== Buffer.byteLength(req.session.csrf) || !timingSafeEqual(Buffer.from(raw), Buffer.from(req.session.csrf))) return res.status(403).send('Invalid request token. Reload the page.');
    }
    next();
  });
  app.use('/assets', express.static(path.join(__dirname, 'assets'), { dotfiles: 'deny', index: false }));
  app.use(routes(options));
  app.use((_req, res) => res.status(404).send('Page not found.'));
  app.use((err, _req, res, _next) => { log('request_failed'); res.status(500).send('The request could not be completed. No private details have been logged.'); });
  return app;
}
module.exports = { createApp };
