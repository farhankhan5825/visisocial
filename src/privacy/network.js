'use strict';
const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');
function publicIPv4(address) {
  if (net.isIP(address) !== 4) return false; // Fail closed for IPv6, including mapped private IPv4.
  const [a, b] = address.split('.').map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && [0, 168].includes(b)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && [18, 19, 51].includes(b)) ||
    (a === 203 && b === 0)
  );
}
// Public IPv6 means global unicast (2000::/3) minus documentation (2001:db8::/32), Teredo
// (2001::/32) and 6to4 (2002::/16), which can tunnel to arbitrary IPv4 targets. IPv4-mapped
// and all local/private ranges fall outside 2000::/3 and are rejected.
function publicIPv6(address) {
  if (net.isIP(address) !== 6) return false;
  const first = parseInt(address.split(':')[0] || '0', 16);
  if (first < 0x2000 || first > 0x3fff) return false;
  const lower = address.toLowerCase();
  return !(
    lower.startsWith('2001:db8:') ||
    lower.startsWith('2001:0:') ||
    lower.startsWith('2001::') ||
    lower.startsWith('2002:')
  );
}
const publicAddress = (address) => publicIPv4(address) || publicIPv6(address);
function photoURL(value) {
  const u = new URL(value);
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.hash ||
    (u.port && u.port !== '443') ||
    !u.hostname.endsWith('.fbcdn.net')
  )
    throw new Error('photo_host_not_allowed');
  return u;
}
async function downloadPhoto(
  value,
  { resolve = (hostname) => dns.lookup(hostname, { all: true }), transport = https.get } = {}
) {
  const u = photoURL(value),
    records = await resolve(u.hostname);
  // Every answer must be public, so a mixed public/private response is refused outright.
  if (!records.length || records.some((r) => !publicAddress(r.address)))
    throw new Error('photo_address_not_public');
  // Pin one checked answer (IPv4 preferred) into the connection; no second lookup/rebinding.
  const selected = records.find((r) => net.isIP(r.address) === 4) || records[0];
  const family = net.isIP(selected.address);
  return new Promise((resolveBody, reject) => {
    const req = transport(
      u,
      {
        // Node may request all addresses (autoSelectFamily); answer in whichever form it asks.
        lookup: (_host, options, callback) =>
          options && options.all
            ? callback(null, [{ address: selected.address, family }])
            : callback(null, selected.address, family),
        timeout: 15000,
      },
      (response) => {
        if (
          response.statusCode !== 200 ||
          !/^image\/(jpeg|png|webp)$/.test(response.headers['content-type']?.split(';')[0] || '')
        ) {
          response.resume();
          reject(new Error('photo_response_rejected'));
          return;
        }
        let size = 0;
        const chunks = [];
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 10 * 1024 * 1024) {
            req.destroy(new Error('photo_too_large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => resolveBody(Buffer.concat(chunks)));
        response.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('photo_timeout')));
    req.on('error', reject);
  });
}
module.exports = { photoURL, publicIPv4, publicIPv6, downloadPhoto };
