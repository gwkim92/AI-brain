import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT_KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, encodedHash: string): boolean {
  const [algorithm, salt, hashHex] = encodedHash.split('$');
  if (algorithm !== 'scrypt' || !salt || !hashHex) {
    return false;
  }

  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString('hex');
  const left = Buffer.from(derived, 'hex');
  const right = Buffer.from(hashHex, 'hex');
  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
