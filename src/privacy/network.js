'use strict';
const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');
function publicIPv4(address) {
  if (net.isIP(address) !== 4) return false; // Fail closed for IPv6, including mapped private IPv4.
  const [a, b] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
}
function photoURL(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.hash || (u.port && u.port !== '443') || !u.hostname.endsWith('.fbcdn.net')) throw new Error('photo_host_not_allowed');
  return u;
}
async function downloadPhoto(value, { resolve = hostname => dns.lookup(hostname, { all: true }), transport = https.get } = {}) {
  const u = photoURL(value), records = await resolve(u.hostname);
  if (!records.length || records.some(r => !publicIPv4(r.address))) throw new Error('photo_address_not_public_ipv4');
  // Pin a checked DNS answer into the connection; no second lookup/rebinding.
  const selected = records[0];
  return new Promise((resolveBody, reject) => {
    const req = transport(u, { lookup: (_host, _options, callback) => callback(null, selected.address, 4), timeout: 15000 }, response => {
      if (response.statusCode !== 200 || !/^image\/(jpeg|png|webp)$/.test(response.headers['content-type']?.split(';')[0] || '')) { response.resume(); reject(new Error('photo_response_rejected')); return; }
      let size = 0; const chunks = [];
      response.on('data', chunk => { size += chunk.length; if (size > 10 * 1024 * 1024) { req.destroy(new Error('photo_too_large')); return; } chunks.push(chunk); });
      response.on('end', () => resolveBody(Buffer.concat(chunks))); response.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('photo_timeout'))); req.on('error', reject);
  });
}
module.exports = { photoURL, publicIPv4, downloadPhoto };
