import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';

// Local JSON + filesystem store. Swap this module for a real database /
// object storage (Supabase, Postgres + Blob, …) when deploying.

export const DATA_DIR = path.join(process.cwd(), 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');

export type EventRecord = {
  id: string;
  slug: string;
  name: string;
  date?: string;
  passwordHash?: string;
  expiresAt?: string;
  /** Public Google Drive folder the photos are synced from. */
  driveFolderId?: string;
  createdAt: string;
};

export type PhotoRecord = {
  id: string;
  eventId: string;
  fileName: string;
  ext: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  /** One 128-d face descriptor per detected face. */
  faces: number[][];
  /**
   * Where each face sits, as [x, y, w, h] fractions of the photo, same order as `faces`.
   * Missing on photos imported before positions were saved — "Scan faces" fills it in.
   */
  boxes?: number[][];
  /** Set when imported from Google Drive; used to skip re-imports. */
  driveFileId?: string;
  /** False when the original stays in Drive (only preview + thumb are stored). */
  hasOriginal?: boolean;
  createdAt: string;
};

// Serialize all writes so parallel uploads never clobber each other.
let queue: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data));
  // On Windows the target can be briefly locked (OneDrive sync, antivirus,
  // another reader), making rename fail with EPERM/EBUSY — retry a few times.
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) {
        await fs.rm(tmp, { force: true });
        throw err;
      }
      await new Promise((r) => setTimeout(r, 50 * 2 ** Math.min(attempt, 4)));
    }
  }
}

export const eventDir = (eventId: string) => path.join(DATA_DIR, 'events', eventId);
const photosFile = (eventId: string) => path.join(eventDir(eventId), 'photos.json');

export async function listEvents() {
  const events = await readJson<EventRecord[]>(EVENTS_FILE, []);
  return events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getEvent(id: string) {
  return (await listEvents()).find((e) => e.id === id) ?? null;
}

export async function getEventBySlug(slug: string) {
  return (await listEvents()).find((e) => e.slug === slug) ?? null;
}

export function createEvent(event: EventRecord) {
  return locked(async () => {
    const events = await readJson<EventRecord[]>(EVENTS_FILE, []);
    events.push(event);
    await writeJson(EVENTS_FILE, events);
    return event;
  });
}

export function updateEvent(id: string, patch: Partial<EventRecord>) {
  return locked(async () => {
    const events = await readJson<EventRecord[]>(EVENTS_FILE, []);
    const idx = events.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    events[idx] = { ...events[idx], ...patch, id };
    // Allow clearing optional fields by passing undefined.
    for (const key of Object.keys(patch) as (keyof EventRecord)[]) {
      if (patch[key] === undefined) delete events[idx][key];
    }
    await writeJson(EVENTS_FILE, events);
    return events[idx];
  });
}

export function deleteEvent(id: string) {
  return locked(async () => {
    const events = await readJson<EventRecord[]>(EVENTS_FILE, []);
    await writeJson(EVENTS_FILE, events.filter((e) => e.id !== id));
    await fs.rm(eventDir(id), { recursive: true, force: true });
  });
}

export async function listPhotos(eventId: string) {
  return readJson<PhotoRecord[]>(photosFile(eventId), []);
}

export async function getPhoto(eventId: string, photoId: string) {
  return (await listPhotos(eventId)).find((p) => p.id === photoId) ?? null;
}

export function addPhoto(photo: PhotoRecord) {
  return locked(async () => {
    const photos = await listPhotos(photo.eventId);
    photos.push(photo);
    await writeJson(photosFile(photo.eventId), photos);
    return photo;
  });
}

/** Replace a photo's faces (and their positions) after a re-scan. */
export function updatePhotoFaces(eventId: string, photoId: string, faces: number[][], boxes: number[][]) {
  return locked(async () => {
    const photos = await listPhotos(eventId);
    const photo = photos.find((p) => p.id === photoId);
    if (!photo) return null;
    photo.faces = faces;
    photo.boxes = boxes;
    await writeJson(photosFile(eventId), photos);
    return photo;
  });
}

export function isExpired(event: EventRecord) {
  return !!event.expiresAt && new Date(event.expiresAt).getTime() < Date.now();
}
