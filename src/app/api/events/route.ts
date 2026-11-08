import { nanoid, customAlphabet } from 'nanoid';
import { hashPassword } from '@/lib/auth';
import { error, json, publicEvent, requireAdmin } from '@/lib/api';
import { createEvent, listEvents, listPhotos } from '@/lib/db';
import { parseFolderId } from '@/lib/drive-public';

const slugId = customAlphabet('abcdefghjkmnpqrstuvwxyz23456789', 10);

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const events = await listEvents();
  const withCounts = await Promise.all(
    events.map(async (e) => publicEvent(e, (await listPhotos(e.id)).length)),
  );
  return json({ events: withCounts });
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    date?: string;
    password?: string;
    expiresAt?: string;
    driveFolderUrl?: string;
  };
  const name = body.name?.trim();
  if (!name) return error('Event name is required', 400);
  const driveFolderId = body.driveFolderUrl ? parseFolderId(body.driveFolderUrl) : undefined;
  if (driveFolderId === null) return error("That doesn't look like a Google Drive folder link", 400);

  const event = await createEvent({
    id: nanoid(12),
    slug: slugId(),
    name,
    date: body.date || undefined,
    passwordHash: body.password ? await hashPassword(body.password) : undefined,
    expiresAt: body.expiresAt ? new Date(body.expiresAt).toISOString() : undefined,
    driveFolderId,
    createdAt: new Date().toISOString(),
  });
  return json({ event: publicEvent(event, 0) }, 201);
}
