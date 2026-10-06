'use strict';
const RETENTION_MS = 24 * 3600000;
class MemoryStore {
  constructor() { this.records = new Map(); }
  async get(owner) { const r = this.records.get(owner); if (!r || r.expiresAt <= Date.now()) { this.records.delete(owner); return null; } return structuredClone(r); }
  async put(owner, fields) { const r = { ...structuredClone(fields), owner, expiresAt: Date.now() + RETENTION_MS }; this.records.set(owner, r); return r; }
  async feedback(owner, item) { const r = await this.get(owner); if (!r) throw new Error('owner_expired'); r.feedback = [...(r.feedback || []), item].slice(-100); this.records.set(owner, r); }
  async delete(owner) { this.records.delete(owner); }
  async sweep() { for (const [owner, r] of this.records) if (r.expiresAt <= Date.now()) this.records.delete(owner); }
}
class MongoStore {
  constructor(db) { this.collection = db.collection('evidence_users_v3'); }
  async init() { await this.collection.createIndex({ owner: 1 }, { unique: true }); await this.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }); }
  async get(owner) { return this.collection.findOne({ owner, expiresAt: { $gt: new Date() } }, { projection: { _id: 0 } }); }
  async put(owner, fields) { const r = { ...fields, owner, expiresAt: new Date(Date.now() + RETENTION_MS) }; await this.collection.replaceOne({ owner }, r, { upsert: true }); return r; }
  async feedback(owner, item) { const result = await this.collection.updateOne({ owner, expiresAt: { $gt: new Date() } }, { $push: { feedback: { $each: [item], $slice: -100 } } }); if (!result.matchedCount) throw new Error('owner_expired'); }
  async delete(owner) { await this.collection.deleteOne({ owner }); }
  async sweep() { await this.collection.deleteMany({ expiresAt: { $lte: new Date() } }); }
}
async function deleteOwner(owner, { store, cache, queue, sessions }) {
  await queue.cancelAndDrain(owner); await store.delete(owner); cache.deleteOwner(owner); await sessions(owner);
}
module.exports = { MemoryStore, MongoStore, RETENTION_MS, deleteOwner };
