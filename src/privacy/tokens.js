'use strict';
const crypto = require('node:crypto');
function encryptionKey(encoded) { if (!/^[a-f0-9]{64}$/i.test(encoded || '')) throw new Error('token_encryption_key_must_be_32_bytes_hex'); return Buffer.from(encoded, 'hex'); }
function encryptToken(token, owner, key) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(owner)); const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return { iv: iv.toString('hex'), ciphertext: ciphertext.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
}
function decryptToken(record, owner, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'hex'));
  decipher.setAAD(Buffer.from(owner)); decipher.setAuthTag(Buffer.from(record.tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'hex')), decipher.final()]).toString('utf8');
}
module.exports = { encryptionKey, encryptToken, decryptToken };
