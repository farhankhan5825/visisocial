'use strict';
class Cache {
  constructor(ttlMs = 3600000) { this.entries = new Map(); this.ttlMs = ttlMs; }
  get(owner, key) { const e = this.entries.get(`${owner}:${key}`); if (!e || e.until <= Date.now()) { this.entries.delete(`${owner}:${key}`); return null; } return structuredClone(e.value); }
  set(owner, key, value) { this.entries.set(`${owner}:${key}`, { owner, until: Date.now() + this.ttlMs, value: structuredClone(value) }); }
  deleteOwner(owner) { for (const [key, e] of this.entries) if (e.owner === owner) this.entries.delete(key); }
  sweep() { for (const [key, e] of this.entries) if (e.until <= Date.now()) this.entries.delete(key); }
}
module.exports = { Cache };
