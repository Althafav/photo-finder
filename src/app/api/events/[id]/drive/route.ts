import { error, json, requireAdmin } from '@/lib/api';
import { getEvent, listPhotos } from '@/lib/db';
import { listPublicFolder } from '@/lib/drive-public';

/** Photos in the event's Drive folder that haven't been imported yet. */
export async function GET(_req: Request, ctx: RouteContext<'/api/events/[id]/drive'>) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await ctx.params;
  const event = await getEvent(id);
  if (!event) return error('Event not found', 404);
  if (!event.driveFolderId) return error('This event has no Drive folder', 400);

  let listing;
  try {
    listing = await listPublicFolder(event.driveFolderId);
  } catch (e) {
    return error((e as Error).message, 422);
  }
  const imported = new Set((await listPhotos(id)).map((p) => p.driveFileId).filter(Boolean));
  const files = listing.files.filter((f) => !imported.has(f.id));
  return json({ files, total: listing.files.length, alreadyImported: listing.files.length - files.length });
}
