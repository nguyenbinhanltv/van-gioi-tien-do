/**
 * Password hashing and policy (docs/25 §2.2–2.3).
 * MVP uses node:crypto scrypt (no native addon, runs on the libuv pool). docs/25 asks for argon2id; swapping it in
 * only touches this file because the stored string is self-describing (`scrypt$N$r$p$salt$hash`) and `needsRehash`
 * lets login upgrade parameters. See DECISIONS D70.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { AUTH_CONFIG } from '../config.js';

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}
/** 16 MiB, tens of milliseconds on one core. */
export const DEFAULT_SCRYPT: ScryptParams = { N: 16384, r: 8, p: 1 };
const KEYLEN = 32;

function derive(password: string, salt: Buffer, prm: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      KEYLEN,
      { N: prm.N, r: prm.r, p: prm.p, maxmem: 256 * prm.N * prm.r },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string, prm: ScryptParams = DEFAULT_SCRYPT): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, prm);
  return `scrypt$${prm.N}$${prm.r}$${prm.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function parse(stored: string): { prm: ScryptParams; salt: Buffer; key: Buffer } | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![N, r, p].every((x) => Number.isInteger(x) && x > 0)) return null;
  return { prm: { N, r, p }, salt: Buffer.from(parts[4]!, 'base64'), key: Buffer.from(parts[5]!, 'base64') };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const rec = parse(stored);
  if (!rec) return false;
  const key = await derive(password, rec.salt, rec.prm);
  return key.length === rec.key.length && timingSafeEqual(key, rec.key);
}

export function needsRehash(stored: string, target: ScryptParams = DEFAULT_SCRYPT): boolean {
  const rec = parse(stored);
  return !rec || rec.prm.N < target.N || rec.prm.r < target.r || rec.prm.p < target.p;
}

export function validateUsername(username: unknown): string | null {
  if (typeof username !== 'string') return 'username must be a string';
  if (!AUTH_CONFIG.USERNAME_RE.test(username.toLowerCase())) return 'username must be 3-20 chars of a-z, 0-9, _';
  return null;
}

export function validatePassword(password: unknown, username: string): string | null {
  if (typeof password !== 'string') return 'password must be a string';
  const pw = password.normalize('NFKC');
  if (pw.length < AUTH_CONFIG.PASSWORD_MIN) return `password must be at least ${AUTH_CONFIG.PASSWORD_MIN} characters`;
  if (pw.length > AUTH_CONFIG.PASSWORD_MAX) return `password must be at most ${AUTH_CONFIG.PASSWORD_MAX} characters`;
  if (pw.toLowerCase() === username.toLowerCase()) return 'password must differ from the username';
  return null;
}
