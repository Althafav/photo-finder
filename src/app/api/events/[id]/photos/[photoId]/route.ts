import { error, json, parseFaceData, publicPhoto, requireAdmin } from '@/lib/api';
import { updatePhotoFaces } from '@/lib/db';

/** Replace a photo's faces with a fresh scan that includes where each face is ("Scan faces"). */
export async function PUT(request: Request, ctx: RouteContext<'/api/events/[id]/photos/[photoId]'>) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id, photoId } = await ctx.params;

  const body = (await request.json().catch(() => ({}))) as { faces?: unknown; boxes?: unknown };
  const faceData = parseFaceData(body.faces, body.boxes);
  if (!faceData?.boxes) return error('Invalid face data', 400);

  const photo = await updatePhotoFaces(id, photoId, faceData.faces, faceData.boxes);
  if (!photo) return error('Photo not found', 404);
  return json({ photo: publicPhoto(photo) });
}
