'use strict';
// Only fixed event names and numeric diagnostics are accepted. No raw URLs or identifiers.
function log(event, metrics = {}) {
  if (!/^[a-z_]+$/.test(event)) throw new Error('unsafe_log_event');
  const safe = Object.fromEntries(Object.entries(metrics).filter(([k, v]) => /^[a-z_]+$/.test(k) && typeof v === 'number' && Number.isFinite(v)));
  process.stdout.write(JSON.stringify({ time: new Date().toISOString(), event, ...safe }) + '\n');
}
module.exports = { log };
