'use strict';
const { createApp } = require('./app');
const { MemoryStore, MongoStore } = require('./privacy/store');
const { Cache } = require('./privacy/cache');
const { Queue } = require('./jobs/queue');
const { encryptionKey } = require('./privacy/tokens');
const { liveProviders } = require('./providers');
const { randomBytes } = require('node:crypto');
const { log } = require('./privacy/logger');
async function start(env = process.env) {
  // Offline mode exists only for automated tests and the evaluation harness.
  const demo = env.APP_MODE === 'offline-test',
    cache = new Cache(),
    queue = new Queue();
  let store = new MemoryStore(),
    sessionStore = new (require('express-session').MemoryStore)(),
    tokenKey,
    origin,
    localLive = false;
  let deleteSessions = (owner) =>
    new Promise((resolve, reject) =>
      sessionStore.all((err, sessions) => {
        if (err) return reject(err);
        const ids = Object.entries(sessions)
          .filter(([, s]) => s.owner === owner)
          .map(([id]) => id);
        Promise.all(
          ids.map(
            (id) =>
              new Promise((done, fail) =>
                sessionStore.destroy(id, (error) => (error ? fail(error) : done()))
              )
          )
        ).then(resolve, reject);
      })
    );
  if (!demo) {
    for (const name of [
      'SESSION_SECRET',
      'TOKEN_ENCRYPTION_KEY',
      'FACEBOOK_APP_ID',
      'FACEBOOK_APP_SECRET',
      'FACEBOOK_TEST_USER_IDS',
      'API_VERSION',
      'MONGODB_URI',
      'PUBLIC_ORIGIN',
    ])
      if (!env[name]) throw new Error('missing_live_configuration');
    if (env.SESSION_SECRET.length < 32) throw new Error('live_requires_strong_secret');
    const u = new URL(env.PUBLIC_ORIGIN);
    if (u.pathname !== '/' || u.search || u.hash || u.username || u.password)
      throw new Error('bare_origin_required');
    // Local live mode exists for the Meta Development Mode workflow: test users, a
    // localhost OAuth callback and a local MongoDB. Everything stays on the loopback
    // interface. Any other live configuration must be production with HTTPS and TLS.
    localLive = env.NODE_ENV === 'development';
    if (localLive) {
      const local = (host) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
      const db = new URL(env.MONGODB_URI.replace(/^mongodb(\+srv)?:/, 'http:'));
      if (u.protocol !== 'http:' || !local(u.hostname) || !local(db.hostname))
        throw new Error('local_live_requires_localhost_origin_and_database');
    } else if (
      env.NODE_ENV !== 'production' ||
      u.protocol !== 'https:' ||
      !env.MONGODB_URI.startsWith('mongodb+srv://')
    ) {
      throw new Error('live_requires_production_https_and_tls_database');
    }
    origin = u.origin;
    tokenKey = encryptionKey(env.TOKEN_ENCRYPTION_KEY);
    const mongoose = require('mongoose');
    await mongoose.connect(env.MONGODB_URI, {
      tls: !localLive,
      serverSelectionTimeoutMS: 10000,
    });
    const db = mongoose.connection.db;
    // A legacy deployment cannot silently inherit unmappable searches, plaintext tokens or uploads.
    for (const collection of ['users', 'usertokens', 'internetsearchresults', 'sessions'])
      if (await db.collection(collection).findOne({}, { projection: { _id: 1 } }))
        throw new Error('legacy_data_migration_required');
    const fs = require('node:fs'),
      path = require('node:path');
    const hasFiles = (dir) =>
      fs.existsSync(dir) &&
      fs
        .readdirSync(dir, { withFileTypes: true })
        .some(
          (entry) => entry.isFile() || (entry.isDirectory() && hasFiles(path.join(dir, entry.name)))
        );
    for (const dir of ['uploads', 'temp', 'evidence'])
      if (hasFiles(path.join(__dirname, '..', dir)))
        throw new Error('legacy_files_migration_required');
    store = new MongoStore(db);
    await store.init();
    sessionStore = require('connect-mongo').create({
      client: mongoose.connection.getClient(),
      collectionName: 'evidence_sessions_v3',
      stringify: false,
      ttl: 3600,
    });
    deleteSessions = (owner) =>
      db.collection('evidence_sessions_v3').deleteMany({ 'session.owner': owner });
  }
  const app = createApp({
    demo,
    production: !demo && !localLive,
    sessionSecret: demo ? randomBytes(32).toString('hex') : env.SESSION_SECRET,
    store,
    cache,
    queue,
    sessionStore,
    deleteSessions,
    tokenKey,
    origin,
    env,
    providers: demo ? undefined : liveProviders(env),
  });
  const sweep = setInterval(() => {
    store.sweep().catch(() => log('retention_failed'));
    cache.sweep();
    if (demo) sessionStore.all(() => {});
  }, 60000);
  sweep.unref();
  const server = app.listen(
    env.PORT === '0' ? 0 : Number(env.PORT) || 3001,
    demo || localLive ? '127.0.0.1' : '0.0.0.0',
    () => log('server_started', { demo: demo ? 1 : 0 })
  );
  server.on('close', () => clearInterval(sweep));
  return { app, server };
}
module.exports = { start };
