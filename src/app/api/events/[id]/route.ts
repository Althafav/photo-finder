import { hashPassword } from '@/lib/auth';
import { error, json, publicEvent, publicPhoto, requireAdmin } from '@/lib/api';
import { deleteEvent, getEvent, listPhotos, updateEvent } from '@/lib/db';
import { parseFolderId } from '@/lib/drive-public';

export async function GET(_req: Request, ctx: RouteContext<'/api/events/[id]'>) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await ctx.params;
  const event = await getEvent(id);
  if (!event) return error('Event not found', 404);
  const photos = await listPhotos(id);
  return json({
    event: publicEvent(event, photos.length),
    photos: photos.map(publicPhoto).reverse(),
  });
}

export async function PATCH(request: Request, ctx: RouteContext<'/api/events/[id]'>) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await ctx.params;

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    date?: string | null;
    /** string sets a new password, null removes it */
    password?: string | null;
    expiresAt?: string | null;
    /** Drive folder link; null or empty unlinks it */
    driveFolderUrl?: string | null;
  };

  const patch: Parameters<typeof updateEvent>[1] = {};
  if (body.name !== undefined) {
    if (!body.name.trim()) return error('Event name is required', 400);
    patch.name = body.name.trim();
  }
  if (body.date !== undefined) patch.date = body.date || undefined;
  if (body.password !== undefined) {
    patch.passwordHash = body.password ? await hashPassword(body.password) : undefined;
  }
  if (body.expiresAt !== undefined) {
    patch.expiresAt = body.expiresAt ? new Date(body.expiresAt).toISOString() : undefined;
  }

  if (body.driveFolderUrl !== undefined) {
    const folderId = body.driveFolderUrl ? parseFolderId(body.driveFolderUrl) : undefined;
    if (folderId === null) return error("That doesn't look like a Google Drive folder link", 400);
    patch.driveFolderId = folderId;
  }

  const event = await updateEvent(id, patch);
  if (!event) return error('Event not found', 404);
  return json({ event: publicEvent(event) });
}

export async function DELETE(_req: Request, ctx: RouteContext<'/api/events/[id]'>) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await ctx.params;
  await deleteEvent(id);
  return json({ ok: true });
}
