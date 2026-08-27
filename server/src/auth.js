import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, SCRYPT);
  return `s2:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [ver, saltHex, hashHex] = stored.split(':');
    if (ver !== 's2') return false;
    const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 32, SCRYPT);
    return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
  } catch {
    return false;
  }
}

export function newToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export const uid = () => crypto.randomBytes(12).toString('base64url');
