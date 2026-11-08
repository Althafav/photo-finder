import 'server-only';
import { isAdmin } from './auth';
import type { EventRecord, PhotoRecord } from './db';

export const json = (data: unknown, status = 200) => Response.json(data, { status });
export const error = (message: string, status: number) => json({ error: message }, status);

export async function requireAdmin() {
  return (await isAdmin()) ? null : error('Unauthorized', 401);
}

/** Shape sent to the dashboard — never includes the password hash. */
export function publicEvent(event: EventRecord, photoCount?: number) {
  const { passwordHash, ...rest } = event;
  return { ...rest, hasPassword: !!passwordHash, photoCount };
}

/** Photo metadata without face descriptors or positions. */
export function publicPhoto(photo: PhotoRecord) {
  const { faces, boxes, ...rest } = photo;
  return { ...rest, faceCount: faces.length, facesLocated: !!boxes };
}

/**
 * Validate face descriptors (128 numbers each) and their [x, y, w, h] boxes from the browser.
 * Boxes may be left out entirely (pages loaded before positions were saved); then they stay unset.
 */
export function parseFaceData(rawFaces: unknown, rawBoxes: unknown) {
  const isNums = (a: unknown, len: number): a is number[] =>
    Array.isArray(a) && a.length === len && a.every((n) => typeof n === 'number' && Number.isFinite(n));
  if (!Array.isArray(rawFaces) || rawFaces.length > 100 || !rawFaces.every((d) => isNums(d, 128))) return null;
  const faces = (rawFaces as number[][]).map((d) => d.map((n) => Math.round(n * 1e5) / 1e5));
  if (rawBoxes === undefined) return { faces, boxes: undefined };
  if (!Array.isArray(rawBoxes) || rawBoxes.length !== faces.length || !rawBoxes.every((b) => isNums(b, 4))) {
    return null;
  }
  const clamp = (n: number) => Math.min(1, Math.max(0, Math.round(n * 1e4) / 1e4));
  return { faces, boxes: (rawBoxes as number[][]).map((b) => b.map(clamp)) };
}
