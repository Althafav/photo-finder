import { canViewEvent } from '@/lib/auth';
import { error, json } from '@/lib/api';
import { getEventBySlug, isExpired, listPhotos } from '@/lib/db';

/** Public info a guest needs before taking a selfie. */
export async function GET(_req: Request, ctx: RouteContext<'/api/g/[slug]'>) {
  const { slug } = await ctx.params;
  const event = await getEventBySlug(slug);
  if (!event) return error('This gallery does not exist', 404);
  if (isExpired(event)) return error('This gallery link has expired', 410);

  const photos = await listPhotos(event.id);
  return json({
    event: {
      name: event.name,
      date: event.date,
      photoCount: photos.length,
      requiresPassword: !!event.passwordHash,
      unlocked: await canViewEvent(event),
    },
  });
}
