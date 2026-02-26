import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

function buildKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

export function encryptSecretValue(input: string, secret: string): string {
  const iv = randomBytes(12);
  const key = buildKey(secret);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(input, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptSecretValue(encryptedPayload: string, secret: string): string {
  const [version, ivEncoded, tagEncoded, dataEncoded] = encryptedPayload.split(':');
  if (version !== 'v1' || !ivEncoded || !tagEncoded || !dataEncoded) {
    throw new Error('invalid encrypted payload format');
  }

  const key = buildKey(secret);
  const iv = Buffer.from(ivEncoded, 'base64url');
  const tag = Buffer.from(tagEncoded, 'base64url');
  const data = Buffer.from(dataEncoded, 'base64url');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

