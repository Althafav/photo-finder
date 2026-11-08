-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Images stay in Google Drive; these tables only hold event and photo records.

create table if not exists public.events (
  id              text primary key,
  slug            text not null unique,
  name            text not null,
  date            text,                 -- "YYYY-MM-DD" as typed in the form
  password_hash   text,
  expires_at      timestamptz,
  drive_folder_id text,
  created_at      timestamptz not null default now()
);

create table if not exists public.photos (
  id            text primary key,
  event_id      text not null references public.events (id) on delete cascade,
  file_name     text not null,
  ext           text not null,
  mime          text not null,
  size          integer not null default 0,
  width         integer not null default 0,
  height        integer not null default 0,
  faces         jsonb not null default '[]'::jsonb,  -- one 128-number descriptor per face
  boxes         jsonb,                                -- [x, y, w, h] per face, same order as faces
  drive_file_id text,
  has_original  boolean,
  created_at    timestamptz not null default now()
);

create index if not exists photos_event_id_created_at_idx on public.photos (event_id, created_at);

-- Lock the tables: with RLS on and no policies, the public "anon" key can't read or write.
-- The app's server uses the service-role key, which bypasses RLS.
alter table public.events enable row level security;
alter table public.photos enable row level security;
