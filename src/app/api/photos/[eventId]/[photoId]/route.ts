import { canViewEvent, isAdmin } from '@/lib/auth';
import { error } from '@/lib/api';
import { getEvent, getPhoto, isExpired } from '@/lib/db';
import { DRIVE_SIZES, driveDownloadUrl, driveImageUrl } from '@/lib/drive-image';

type PhotoSize = 'thumb' | 'preview' | 'original';
const SIZES: PhotoSize[] = ['thumb', 'preview', 'original'];

/**
 * Checks the viewer may see this photo, then sends them to Google Drive's copy
 * (`?size=thumb|preview|original`). No images are stored or relayed by this server.
 */
export async function GET(request: Request, ctx: RouteContext<'/api/photos/[eventId]/[photoId]'>) {
  const { eventId, photoId } = await ctx.params;
  const size = (new URL(request.url).searchParams.get('size') ?? 'preview') as PhotoSize;
  if (!SIZES.includes(size)) return error('Invalid size', 400);

  const event = await getEvent(eventId);
  if (!event) return error('Not found', 404);
  const admin = await isAdmin();
  if (!admin && (isExpired(event) || !(await canViewEvent(event)))) {
    return error('Forbidden', 403);
  }

  const photo = await getPhoto(eventId, photoId);
  if (!photo?.driveFileId) return error('Not found', 404);

  const location =
    size === 'original' ? driveDownloadUrl(photo.driveFileId) : driveImageUrl(photo.driveFileId, DRIVE_SIZES[size]);
  // Let the browser reuse the redirect for an hour instead of asking again for every view.
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'private, max-age=3600' },
  });
}
