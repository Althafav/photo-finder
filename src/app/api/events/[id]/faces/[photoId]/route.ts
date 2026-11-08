import sharp from 'sharp';
import { error, requireAdmin } from '@/lib/api';
import { getPhoto } from '@/lib/db';
import { driveImageUrl } from '@/lib/drive-image';

/** Output size: sharp on a 64px circle at 2× pixel density. */
const SIZE = 128;
/** Room around the face inside the crop. */
const PAD = 1.7;
/** Same size face detection used, so small faces still have enough pixels. */
const SOURCE_SIZE = 1280;
/** Crops kept in memory (~5 KB each). Nothing is written to disk. */
const MAX_CACHED = 1000;
/** Drive fetches at once; a burst of ~200 makes Google answer 429. */
const MAX_PARALLEL = 4;

const cache = new Map<string, Buffer>();
const pending = new Map<string, Promise<Buffer>>();
let active = 0;
const waiting: (() => void)[] = [];

async function limited<T>(fn: () => Promise<T>) {
  if (active >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

async function fetchDrive(fileId: string) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(driveImageUrl(fileId, SOURCE_SIZE), { cache: 'no-store' });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt >= 3 || (res.status !== 429 && res.status < 500)) throw new Error(`Drive returned ${res.status}`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

async function cropFace(fileId: string, box: number[]) {
  const image = sharp(await limited(() => fetchDrive(fileId)));
  const { width: W = 0, height: H = 0 } = await image.metadata();
  if (!W || !H) throw new Error('Unreadable photo');

  // Square around the face's centre, padded, kept inside the photo.
  const [bx, by, bw, bh] = box;
  const side = Math.max(1, Math.round(Math.min(Math.max(bw * W, bh * H) * PAD, W, H)));
  const clamp = (v: number, max: number) => Math.round(Math.min(Math.max(v, 0), max));
  return image
    .extract({
      left: clamp((bx + bw / 2) * W - side / 2, W - side),
      top: clamp((by + bh / 2) * H - side / 2, H - side),
      width: side,
      height: side,
    })
    .resize(SIZE, SIZE)
    .jpeg({ quality: 82 })
    .toBuffer();
}

/**
 * A small square crop of one face (`?face=<index>`), cut from the photo's Google Drive
 * copy, so the people list doesn't load whole photos just to show faces.
 */
export async function GET(request: Request, ctx: RouteContext<'/api/events/[id]/faces/[photoId]'>) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id, photoId } = await ctx.params;
  const index = Number(new URL(request.url).searchParams.get('face'));

  const photo = await getPhoto(id, photoId);
  const box = photo?.boxes?.[index];
  if (!photo?.driveFileId || !box) return error('Face not found', 404);

  const key = `${photoId}:${index}:${box.join(',')}`;
  let jpeg = cache.get(key);
  if (!jpeg) {
    let job = pending.get(key);
    if (!job) {
      job = cropFace(photo.driveFileId, box).finally(() => pending.delete(key));
      pending.set(key, job);
    }
    try {
      jpeg = await job;
    } catch (e) {
      return error((e as Error).message, 502);
    }
    cache.set(key, jpeg);
    // Drop the oldest crops once the cache is full (Map keeps insertion order).
    while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  }

  return new Response(new Uint8Array(jpeg), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' },
  });
}
