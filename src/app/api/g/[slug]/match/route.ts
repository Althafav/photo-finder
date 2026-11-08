import { canViewEvent } from '@/lib/auth';
import { error, json } from '@/lib/api';
import { getEventBySlug, isExpired, listPhotos } from '@/lib/db';

/** Loosest distance we ever return; the guest UI narrows it with a slider. */
const MAX_DISTANCE = 0.62;

function distance(a: number[], b: number[]) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Match a selfie against every face in the event. Only the 128-number face
 * descriptor is sent here — the selfie image itself never leaves the device.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/g/[slug]/match'>) {
  const { slug } = await ctx.params;
  const event = await getEventBySlug(slug);
  if (!event) return error('This gallery does not exist', 404);
  if (isExpired(event)) return error('This gallery link has expired', 410);
  if (!(await canViewEvent(event))) return error('Password required', 401);

  const { descriptor } = (await request.json().catch(() => ({}))) as { descriptor?: unknown };
  if (
    !Array.isArray(descriptor) ||
    descriptor.length !== 128 ||
    !descriptor.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    return error('Invalid face descriptor', 400);
  }

  const photos = await listPhotos(event.id);
  const matches = photos
    .map((p) => ({
      photo: p,
      distance: p.faces.reduce((best, f) => Math.min(best, distance(descriptor, f)), Infinity),
    }))
    .filter((m) => m.distance <= MAX_DISTANCE)
    .sort((a, b) => a.distance - b.distance)
    .map(({ photo, distance }) => ({
      id: photo.id,
      fileName: photo.fileName,
      width: photo.width,
      height: photo.height,
      distance: Math.round(distance * 1000) / 1000,
      thumb: `/api/photos/${event.id}/${photo.id}?size=thumb`,
      preview: `/api/photos/${event.id}/${photo.id}?size=preview`,
      download: `/api/photos/${event.id}/${photo.id}?size=original&download=1`,
    }));

  return json({ matches, scanned: photos.length });
}
