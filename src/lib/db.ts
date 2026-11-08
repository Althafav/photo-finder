import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Event and photo records live in Supabase Postgres (tables in supabase/schema.sql).
// Images themselves stay in Google Drive. This module runs only on the server and
// uses the service-role key, so the tables can stay locked to the public.

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

// ---- Client ---------------------------------------------------------------

let client: SupabaseClient | undefined;

function db() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

/** Throw Supabase errors so routes fail loudly instead of acting on missing data. */
function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data;
}

// ---- Row mapping (snake_case columns ↔ camelCase records) -----------------

type EventRow = {
  id: string;
  slug: string;
  name: string;
  date: string | null;
  password_hash: string | null;
  expires_at: string | null;
  drive_folder_id: string | null;
  created_at: string;
};

type PhotoRow = {
  id: string;
  event_id: string;
  file_name: string;
  ext: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  faces: number[][];
  boxes: number[][] | null;
  drive_file_id: string | null;
  has_original: boolean | null;
  created_at: string;
};

// Postgres returns timestamps as "2026-11-08 10:00:00+00"; keep the ISO format the app has always used.
const iso = (value: string) => new Date(value).toISOString();
const opt = <T>(value: T | null) => value ?? undefined;

function toEvent(row: EventRow): EventRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    date: opt(row.date),
    passwordHash: opt(row.password_hash),
    expiresAt: row.expires_at ? iso(row.expires_at) : undefined,
    driveFolderId: opt(row.drive_folder_id),
    createdAt: iso(row.created_at),
  };
}

// Field → column for event writes. `undefined` becomes null, which is how a field is cleared.
const EVENT_COLUMNS: Record<keyof EventRecord, keyof EventRow> = {
  id: 'id',
  slug: 'slug',
  name: 'name',
  date: 'date',
  passwordHash: 'password_hash',
  expiresAt: 'expires_at',
  driveFolderId: 'drive_folder_id',
  createdAt: 'created_at',
};

function eventToRow(event: Partial<EventRecord>) {
  const row: Record<string, unknown> = {};
  for (const key of Object.keys(event) as (keyof EventRecord)[]) {
    row[EVENT_COLUMNS[key]] = event[key] ?? null;
  }
  return row;
}

function toPhoto(row: PhotoRow): PhotoRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    fileName: row.file_name,
    ext: row.ext,
    mime: row.mime,
    size: row.size,
    width: row.width,
    height: row.height,
    faces: row.faces,
    boxes: opt(row.boxes),
    driveFileId: opt(row.drive_file_id),
    hasOriginal: opt(row.has_original),
    createdAt: iso(row.created_at),
  };
}

function photoToRow(photo: PhotoRecord): PhotoRow {
  return {
    id: photo.id,
    event_id: photo.eventId,
    file_name: photo.fileName,
    ext: photo.ext,
    mime: photo.mime,
    size: photo.size,
    width: photo.width,
    height: photo.height,
    faces: photo.faces,
    boxes: photo.boxes ?? null,
    drive_file_id: photo.driveFileId ?? null,
    has_original: photo.hasOriginal ?? null,
    created_at: photo.createdAt,
  };
}

// ---- Events ---------------------------------------------------------------

export async function listEvents() {
  const rows = check(await db().from('events').select('*').order('created_at', { ascending: false }));
  return (rows as EventRow[]).map(toEvent);
}

export async function getEvent(id: string) {
  const row = check(await db().from('events').select('*').eq('id', id).maybeSingle());
  return row ? toEvent(row as EventRow) : null;
}

export async function getEventBySlug(slug: string) {
  const row = check(await db().from('events').select('*').eq('slug', slug).maybeSingle());
  return row ? toEvent(row as EventRow) : null;
}

export async function createEvent(event: EventRecord) {
  const row = check(await db().from('events').insert(eventToRow(event)).select().single());
  return toEvent(row as EventRow);
}

/** Pass a field as `undefined` to clear it. */
export async function updateEvent(id: string, patch: Partial<EventRecord>) {
  const changes = eventToRow(patch);
  delete changes.id; // An event's id never changes.
  const row = check(await db().from('events').update(changes).eq('id', id).select().maybeSingle());
  return row ? toEvent(row as EventRow) : null;
}

/** Deleting an event also deletes its photos (ON DELETE CASCADE). */
export async function deleteEvent(id: string) {
  check(await db().from('events').delete().eq('id', id));
}

// ---- Photos ---------------------------------------------------------------

// Supabase returns at most 1,000 rows per request, so read big events page by page.
const PAGE = 1000;

export async function listPhotos(eventId: string) {
  const photos: PhotoRecord[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = check(
      await db()
        .from('photos')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at')
        .order('id')
        .range(from, from + PAGE - 1),
    ) as PhotoRow[];
    photos.push(...rows.map(toPhoto));
    if (rows.length < PAGE) return photos;
  }
}

export async function getPhoto(eventId: string, photoId: string) {
  const row = check(
    await db().from('photos').select('*').eq('event_id', eventId).eq('id', photoId).maybeSingle(),
  );
  return row ? toPhoto(row as PhotoRow) : null;
}

export async function addPhoto(photo: PhotoRecord) {
  check(await db().from('photos').insert(photoToRow(photo)));
  return photo;
}

/** Replace a photo's faces (and their positions) after a re-scan. */
export async function updatePhotoFaces(eventId: string, photoId: string, faces: number[][], boxes: number[][]) {
  const row = check(
    await db()
      .from('photos')
      .update({ faces, boxes })
      .eq('event_id', eventId)
      .eq('id', photoId)
      .select()
      .maybeSingle(),
  );
  return row ? toPhoto(row as PhotoRow) : null;
}

export function isExpired(event: EventRecord) {
  return !!event.expiresAt && new Date(event.expiresAt).getTime() < Date.now();
}
