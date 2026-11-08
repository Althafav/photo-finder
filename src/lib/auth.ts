import 'server-only';
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { cookies } from 'next/headers';
import type { EventRecord } from './db';

const scryptAsync = promisify(scrypt) as (pw: string, salt: string, len: number) => Promise<Buffer>;

export const ADMIN_COOKIE = 'ep_admin';
const guestCookie = (eventId: string) => `ep_guest_${eventId}`;
const ADMIN_TTL = 60 * 60 * 24 * 7; // 7 days
const GUEST_TTL = 60 * 60 * 24; // 1 day

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set. Add it to .env.local.');
  return s;
}

function sign(payload: string) {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** Token format: `<subject>.<expiresAtSeconds>.<signature>` */
function makeToken(subject: string, ttl: number) {
  const body = `${subject}.${Math.floor(Date.now() / 1000) + ttl}`;
  return `${body}.${sign(body)}`;
}

function verifyToken(token: string | undefined, subject: string) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [sub, exp, sig] = parts;
  const expected = Buffer.from(sign(`${sub}.${exp}`));
  const given = Buffer.from(sig);
  return (
    sub === subject &&
    Number(exp) * 1000 > Date.now() &&
    expected.length === given.length &&
    timingSafeEqual(expected, given)
  );
}

const cookieOpts = (maxAge: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge,
});

export function checkAdminPassword(password: string) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw new Error('ADMIN_PASSWORD is not set. Add it to .env.local.');
  const a = Buffer.from(sign(password));
  const b = Buffer.from(sign(expected));
  return timingSafeEqual(a, b);
}

export async function setAdminSession() {
  (await cookies()).set(ADMIN_COOKIE, makeToken('admin', ADMIN_TTL), cookieOpts(ADMIN_TTL));
}

export async function clearAdminSession() {
  (await cookies()).delete(ADMIN_COOKIE);
}

export async function isAdmin() {
  return verifyToken((await cookies()).get(ADMIN_COOKIE)?.value, 'admin');
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt, 32);
  return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(':');
  const hash = await scryptAsync(password, salt, 32);
  const expected = Buffer.from(hex, 'hex');
  return expected.length === hash.length && timingSafeEqual(expected, hash);
}

export async function grantGuestAccess(eventId: string) {
  (await cookies()).set(guestCookie(eventId), makeToken(eventId, GUEST_TTL), cookieOpts(GUEST_TTL));
}

/** Guests can see an event if it has no password, or they unlocked it. Admins always can. */
export async function canViewEvent(event: EventRecord) {
  if (!event.passwordHash) return true;
  if (await isAdmin()) return true;
  return verifyToken((await cookies()).get(guestCookie(event.id))?.value, event.id);
}
