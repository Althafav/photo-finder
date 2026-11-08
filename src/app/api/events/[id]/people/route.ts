import { error, json, requireAdmin } from '@/lib/api';
import { getEvent, listPhotos, type PhotoRecord } from '@/lib/db';

/** Max distance from a person's average face to count as the same person. */
const SAME_PERSON = 0.48;
/** Faces narrower than this (fraction of photo width) are too small to identify reliably. */
const MIN_FACE_WIDTH = 0.025;
/** People seen in fewer photos are mostly passers-by and blurry background faces. */
const MIN_PHOTOS = 2;

type Face = { photo: PhotoRecord; index: number; desc: number[]; box?: number[] };
type Group = { sum: Float64Array; count: number; faces: Face[]; photoIds: Set<string> };

function distanceToMean(desc: number[], g: Group) {
  let s = 0;
  for (let i = 0; i < 128; i++) {
    const d = desc[i] - g.sum[i] / g.count;
    s += d * d;
  }
  return Math.sqrt(s);
}

function groupFaces(photos: PhotoRecord[]) {
  const faces: Face[] = [];
  for (const photo of photos) {
    photo.faces.forEach((desc, i) => {
      const box = photo.boxes?.[i];
      if (box && box[2] < MIN_FACE_WIDTH) return;
      faces.push({ photo, index: i, desc, box });
    });
  }
  // Biggest (clearest) faces first, so each person starts from a good example.
  const area = (f: Face) => (f.box ? f.box[2] * f.box[3] : 0);
  faces.sort((a, b) => area(b) - area(a));

  const groups: Group[] = [];
  for (const face of faces) {
    let best: Group | null = null;
    let bestDist = SAME_PERSON;
    for (const g of groups) {
      // One person can't be in the same photo twice — without this rule, look-alike
      // guests standing together get merged into one "person".
      if (g.photoIds.has(face.photo.id)) continue;
      const d = distanceToMean(face.desc, g);
      if (d < bestDist) {
        bestDist = d;
        best = g;
      }
    }
    if (!best) {
      best = { sum: new Float64Array(128), count: 0, faces: [], photoIds: new Set() };
      groups.push(best);
    }
    for (let i = 0; i < 128; i++) best.sum[i] += face.desc[i];
    best.count++;
    best.faces.push(face);
    best.photoIds.add(face.photo.id);
  }

  const order = new Map(photos.map((p, i) => [p.id, i]));
  return groups
    .map((g) => {
      const photoIds = [...g.photoIds].sort((a, b) => order.get(a)! - order.get(b)!);
      // Faces are in size order, so the first one with a position is the clearest picture of them.
      const cover = g.faces.find((f) => f.box);
      return {
        photoIds,
        // Served as a small crop by /api/events/[id]/faces/[photoId]?face=<index>.
        cover: cover && { photoId: cover.photo.id, face: cover.index },
      };
    })
    .filter((p) => p.photoIds.length >= MIN_PHOTOS)
    .sort((a, b) => b.photoIds.length - a.photoIds.length)
    .map((p, i) => ({ id: `person-${i + 1}`, ...p }));
}

// Grouping ~5,000 faces takes a moment, so reuse it until the photos or faces change.
const cache = new Map<string, { key: string; people: ReturnType<typeof groupFaces> }>();

/** Everyone who appears in the event's photos, most-photographed first. */
export async function GET(_req: Request, ctx: RouteContext<'/api/events/[id]/people'>) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!(await getEvent(id))) return error('Event not found', 404);

  const photos = await listPhotos(id);
  const faceCount = photos.reduce((n, p) => n + p.faces.length, 0);
  const located = photos.filter((p) => p.boxes).length;
  const key = `${photos.length}:${faceCount}:${located}`;

  let entry = cache.get(id);
  if (entry?.key !== key) {
    entry = { key, people: groupFaces(photos) };
    cache.set(id, entry);
  }

  return json({ people: entry.people, photosWithoutPositions: photos.length - located });
}
