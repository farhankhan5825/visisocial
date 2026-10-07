'use strict';
// One serial, in-process queue. Jobs do not survive a restart.
class Queue {
  constructor() {
    this.tail = Promise.resolve();
    this.pending = new Map();
    this.deleted = new Set();
  }
  add(owner, fn) {
    if (this.deleted.has(owner)) return Promise.reject(new Error('owner_deleted'));
    if (this.pending.has(owner)) return this.pending.get(owner);
    const job = this.tail.then(() => {
      if (this.deleted.has(owner)) throw new Error('owner_deleted');
      return fn(() => this.deleted.has(owner));
    });
    this.tail = job.catch(() => {});
    this.pending.set(owner, job);
    job.finally(() => this.pending.delete(owner)).catch(() => {});
    return job;
  }
  async cancelAndDrain(owner) {
    this.deleted.add(owner);
    await this.pending.get(owner)?.catch(() => {});
    const timer = setTimeout(() => this.deleted.delete(owner), 3600000);
    timer.unref();
  }
  active(owner) {
    return this.pending.has(owner);
  }
}
module.exports = { Queue };
