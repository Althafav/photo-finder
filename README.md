# Event Photos

Face-matched event galleries, inspired by [pixel-match](https://github.com/tosif121/pixel-match).
A photographer uploads event photos, shares one link/QR code, and each guest takes a
selfie to instantly get only the photos they appear in.

## How it works

1. **Photographer** logs in at `/login`, creates an event (optional guest password + expiry),
   and drops in photos. Each photo is resized and its faces are detected **in the browser**
   (`@vladmandic/face-api`, SSD MobileNet + 128-d face descriptors) before upload.
2. **Share** the guest link `/g/<slug>` or its QR code.
3. **Guest** takes a selfie (camera or upload). The face descriptor is computed on their
   device — the selfie image is never uploaded — and the server compares it against every
   indexed face. Results can be tuned Strict / Balanced / Loose, viewed in a lightbox and
   downloaded in original quality.

## Run locally

```bash
npm install
npm run dev
```

Set these in `.env.local` (see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Photographer login password |
| `AUTH_SECRET` | Long random string used to sign session cookies |

## Import from a Google Drive folder

No Google account setup or API keys needed. Share the Drive folder as
**Anyone with the link**, then paste its link when creating an event (or later under
**Settings**). The app lists the folder (including subfolders) and imports every JPEG, PNG
or WebP photo.

- Photos are fetched as 2048px copies, so faces are indexed without downloading the
  full-size files. **Originals stay in Drive**: when a guest taps *Download original*, they
  are sent to Drive's own download link. Only a preview and thumbnail (~0.5 MB per photo)
  are stored locally.
- Indexing runs in your browser at roughly 1–1.5 s per photo, so 1,500 photos take about
  30 minutes. Keep the tab open. **Pause** stops it, and **Sync from Drive** continues
  where it left off and picks up photos added to the folder later.
- Listing relies on Google's embeddable folder view (`drive.google.com/embeddedfolderview`),
  which isn't an official API. If Google changes it, the import needs updating.

## Storage

Event and photo records (including face descriptors) are stored in Supabase Postgres
(see `src/lib/db.ts`); the images themselves stay in Google Drive.

1. Create a Supabase project and run `supabase/schema.sql` in its SQL Editor.
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (and in your host's
   environment variables, e.g. Vercel).
3. To copy data from the old local store in `./data`, run
   `node --env-file=.env.local scripts/migrate-to-supabase.mjs` (safe to re-run).

## Differences from pixel-match

- Photos can be uploaded directly or synced from a public Google Drive folder link (no OAuth or API keys).
- Faces are indexed once at upload time, so guest matching is instant instead of
  re-scanning every image per guest.
- Detects **all** faces per photo (group shots), not just one.
