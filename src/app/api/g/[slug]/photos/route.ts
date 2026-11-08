import { canViewEvent } from '@/lib/auth';
import { error, json } from '@/lib/api';
import { getEventBySlug, isExpired, listPhotos } from '@/lib/db';

/** Every photo in the event, in import order (roughly shooting order), for guests to browse. */
export async function GET(_req: Request, ctx: RouteContext<'/api/g/[slug]/photos'>) {
  const { slug } = await ctx.params;
  const event = await getEventBySlug(slug);
  if (!event) return error('This gallery does not exist', 404);
  if (isExpired(event)) return error('This gallery link has expired', 410);
  if (!(await canViewEvent(event))) return error('Password required', 401);

  const photos = (await listPhotos(event.id)).map((photo) => ({
    id: photo.id,
    fileName: photo.fileName,
    width: photo.width,
    height: photo.height,
    thumb: `/api/photos/${event.id}/${photo.id}?size=thumb`,
    preview: `/api/photos/${event.id}/${photo.id}?size=preview`,
    download: `/api/photos/${event.id}/${photo.id}?size=original&download=1`,
  }));

  return json({ photos });
}
