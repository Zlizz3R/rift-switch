// Password-based protection that doesn't depend on this PC: logins inside an export file
// (scrypt + AES-256-GCM) and the app lock (salted scrypt hash, constant-time compare).
const crypto = require('crypto');

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const LOCK_SCRYPT = { N: 1 << 14, r: 8, p: 1 };

function sealSecrets(obj, pass) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(String(pass), salt, 32, SCRYPT);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { kdf: 'scrypt', N: SCRYPT.N, salt: salt.toString('base64'), iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}
// null for a wrong password or a damaged/foreign box
function openSecrets(box, pass) {
  try {
    if (!box || box.kdf !== 'scrypt' || box.N !== SCRYPT.N) return null;
    const key = crypto.scryptSync(String(pass), Buffer.from(box.salt, 'base64'), 32, SCRYPT);
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
    d.setAuthTag(Buffer.from(box.tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8'));
  } catch { return null; }
}

const lockHash = (pass, salt) => crypto.scryptSync(String(pass), Buffer.from(salt, 'base64'), 32, LOCK_SCRYPT).toString('base64');
function makeLock(pass) {
  const salt = crypto.randomBytes(16).toString('base64');
  return { salt, hash: lockHash(pass, salt) };
}
function lockMatches(lock, pass) {
  if (!lock || !lock.salt || !lock.hash || typeof pass !== 'string') return false;
  const a = Buffer.from(lockHash(pass, lock.salt), 'base64'), b = Buffer.from(lock.hash, 'base64');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { sealSecrets, openSecrets, makeLock, lockMatches };
