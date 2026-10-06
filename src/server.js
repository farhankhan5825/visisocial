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
  const demo = env.APP_MODE !== 'live', cache = new Cache(), queue = new Queue();
  let store = new MemoryStore(), sessionStore = new (require('express-session').MemoryStore)(), tokenKey, origin;
  let deleteSessions = owner => new Promise((resolve, reject) => sessionStore.all((err, sessions) => {
    if (err) return reject(err);
    const ids = Object.entries(sessions).filter(([, s]) => s.owner === owner).map(([id]) => id);
    Promise.all(ids.map(id => new Promise((done, fail) => sessionStore.destroy(id, error => error ? fail(error) : done())))).then(resolve, reject);
  }));
  if (!demo) {
    for (const name of ['SESSION_SECRET', 'TOKEN_ENCRYPTION_KEY', 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'FACEBOOK_TEST_USER_IDS', 'API_VERSION', 'MONGODB_URI', 'PUBLIC_ORIGIN']) if (!env[name]) throw new Error('missing_live_configuration');
    if (env.NODE_ENV !== 'production' || env.SESSION_SECRET.length < 32 || !env.MONGODB_URI.startsWith('mongodb+srv://')) throw new Error('live_requires_production_tls_and_strong_secret');
    const u = new URL(env.PUBLIC_ORIGIN); if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.hash || u.username || u.password) throw new Error('https_origin_required'); origin = u.origin;
    tokenKey = encryptionKey(env.TOKEN_ENCRYPTION_KEY);
    const mongoose = require('mongoose'); await mongoose.connect(env.MONGODB_URI, { tls: true, serverSelectionTimeoutMS: 10000 });
    const db = mongoose.connection.db;
    // A legacy deployment cannot silently inherit unmappable searches, plaintext tokens or uploads.
    for (const collection of ['users', 'usertokens', 'internetsearchresults', 'sessions']) if (await db.collection(collection).findOne({}, { projection: { _id: 1 } })) throw new Error('legacy_data_migration_required');
    const fs = require('node:fs'), path = require('node:path');
    const hasFiles = dir => fs.existsSync(dir) && fs.readdirSync(dir, { withFileTypes: true }).some(entry => entry.isFile() || (entry.isDirectory() && hasFiles(path.join(dir, entry.name))));
    for (const dir of ['uploads', 'temp', 'evidence']) if (hasFiles(path.join(__dirname, '..', dir))) throw new Error('legacy_files_migration_required');
    store = new MongoStore(db); await store.init();
    sessionStore = require('connect-mongo').create({ client: mongoose.connection.getClient(), collectionName: 'evidence_sessions_v3', stringify: false, ttl: 3600 });
    deleteSessions = owner => db.collection('evidence_sessions_v3').deleteMany({ 'session.owner': owner });
  }
  const app = createApp({ demo, production: !demo, sessionSecret: demo ? randomBytes(32).toString('hex') : env.SESSION_SECRET, store, cache, queue, sessionStore, deleteSessions, tokenKey, origin, env, providers: demo ? undefined : liveProviders(env) });
  const sweep = setInterval(() => { store.sweep().catch(() => log('retention_failed')); cache.sweep(); if (demo) sessionStore.all(() => {}); }, 60000); sweep.unref();
  const server = app.listen(env.PORT === '0' ? 0 : Number(env.PORT) || 3001, demo ? '127.0.0.1' : '0.0.0.0', () => log('server_started', { demo: demo ? 1 : 0 }));
  server.on('close', () => clearInterval(sweep));
  return { app, server };
}
module.exports = { start };
