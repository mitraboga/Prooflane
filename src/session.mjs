import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'prooflane_session';
const lifetime = 30 * 24 * 60 * 60;
const sign = (value, secret) => createHmac('sha256', secret).update(value).digest('base64url');

export function readSession(cookieHeader, secret, now = Date.now()) {
  if (typeof cookieHeader !== 'string' || cookieHeader.length > 8192) return null;
  const matches = cookieHeader.split(';').map(x => x.trim()).filter(x => x.startsWith(`${SESSION_COOKIE}=`));
  if (matches.length !== 1) return null;
  const parts = matches[0].slice(SESSION_COOKIE.length + 1).split('.');
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]{43}$/.test(parts[0]) || !/^\d{10,11}$/.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return null;
  const expiry = Number(parts[1]);
  const seconds = Math.floor(now / 1000);
  if (expiry <= seconds || expiry > seconds + lifetime + 60) return null;
  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`, secret));
  const actual = Buffer.from(parts[2]);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? parts[0] : null;
}

export function createSession(secret, now = Date.now()) {
  const scope = randomBytes(32).toString('base64url');
  const value = `${scope}.${Math.floor(now / 1000) + lifetime}`;
  return { scope, cookie: `${SESSION_COOKIE}=${value}.${sign(value, secret)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${lifetime}` };
}

export class RequestLimiter {
  constructor({ perSession = 60, global = 300, windowMs = 60000, maxEntries = 4096 } = {}) {
    Object.assign(this, { perSession, global, windowMs, maxEntries }); this.entries = new Map(); this.window = 0; this.total = 0;
  }
  allow(scope, now = Date.now()) {
    const window = Math.floor(now / this.windowMs);
    if (window !== this.window) { this.entries.clear(); this.window = window; this.total = 0; }
    if (++this.total > this.global) return false;
    if (!this.entries.has(scope) && this.entries.size >= this.maxEntries) return false;
    const used = (this.entries.get(scope) ?? 0) + 1;
    this.entries.set(scope, used);
    return used <= this.perSession;
  }
}
