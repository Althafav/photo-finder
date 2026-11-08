// One-time copy of the old local store (./data) into Supabase.
// Run after supabase/schema.sql, with the Supabase keys in .env.local:
//   node --env-file=.env.local scripts/migrate-to-supabase.mjs
// Safe to run again: rows are upserted by id, so nothing is duplicated.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.');
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const DATA_DIR = path.join(process.cwd(), 'data');
const BATCH = 200; // Keep each request small; face descriptors make rows a few KB each.

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function upsert(table, rows) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + BATCH), { onConflict: 'id' });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

const events = await readJson(path.join(DATA_DIR, 'events.json'), []);
console.log(`Events: ${events.length}`);
await upsert(
  'events',
  events.map((e) => ({
    id: e.id,
    slug: e.slug,
    name: e.name,
    date: e.date ?? null,
    password_hash: e.passwordHash ?? null,
    expires_at: e.expiresAt ?? null,
    drive_folder_id: e.driveFolderId ?? null,
    created_at: e.createdAt,
  })),
);

for (const event of events) {
  const photos = await readJson(path.join(DATA_DIR, 'events', event.id, 'photos.json'), []);
  await upsert(
    'photos',
    photos.map((p) => ({
      id: p.id,
      event_id: p.eventId,
      file_name: p.fileName,
      ext: p.ext,
      mime: p.mime,
      size: p.size ?? 0,
      width: p.width ?? 0,
      height: p.height ?? 0,
      faces: p.faces ?? [],
      boxes: p.boxes ?? null,
      drive_file_id: p.driveFileId ?? null,
      has_original: p.hasOriginal ?? null,
      created_at: p.createdAt,
    })),
  );
  console.log(`  "${event.name}": ${photos.length} photos`);
}

console.log('Done.');
