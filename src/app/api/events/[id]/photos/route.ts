import { nanoid } from 'nanoid';
import { error, json, parseFaceData, publicPhoto, requireAdmin } from '@/lib/api';
import { addPhoto, getEvent, type PhotoRecord } from '@/lib/db';

/**
 * Record one photo imported from Google Drive. The browser loads the image from
 * Drive and finds the faces; only the record is stored here — images stay in Drive.
 * (Any image parts in the form, sent by older pages, are ignored.)
 */
export async function POST(request: Request, ctx: RouteContext<'/api/events/[id]/photos'>) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await ctx.params;
  const event = await getEvent(id);
  if (!event) return error('Event not found', 404);

  const form = await request.formData();
  let meta: {
    width?: number;
    height?: number;
    faces?: unknown;
    boxes?: unknown;
    driveFileId?: unknown;
    fileName?: unknown;
  };
  try {
    meta = JSON.parse(String(form.get('meta') ?? '{}'));
  } catch {
    return error('Invalid metadata', 400);
  }

  const driveFileId =
    typeof meta.driveFileId === 'string' && /^[\w-]{10,100}$/.test(meta.driveFileId) ? meta.driveFileId : undefined;
  if (!driveFileId) return error('Missing Drive file', 400);
  const faceData = parseFaceData(meta.faces ?? [], meta.boxes);
  if (!faceData) return error('Invalid face data', 400);

  const photo: PhotoRecord = {
    id: nanoid(14),
    eventId: id,
    fileName: String(meta.fileName ?? 'photo.jpg').slice(0, 200),
    ext: 'jpg',
    mime: 'image/jpeg',
    size: 0,
    width: Math.round(Number(meta.width) || 0),
    height: Math.round(Number(meta.height) || 0),
    faces: faceData.faces,
    boxes: faceData.boxes,
    driveFileId,
    hasOriginal: false,
    createdAt: new Date().toISOString(),
  };
  await addPhoto(photo);

  return json({ photo: publicPhoto(photo) }, 201);
}
