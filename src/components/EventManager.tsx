'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'react-qr-code';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  ExternalLink,
  HardDrive,
  Pause,
  RefreshCw,
  Settings2,
  Trash2,
  Users,
} from 'lucide-react';
import { adminFetch, DashboardHeader, type AdminEvent } from '@/components/DashboardHeader';
import PeopleStrip, { type Person } from '@/components/PeopleStrip';
import PhotoViewer from '@/components/PhotoViewer';
import { Button, buttonClass, Card, Field, Input, Spinner } from '@/components/ui';
import { driveFolderUrl, fetchDriveImage, type DriveFile } from '@/lib/drive';
import { loadFaceApi, processPhoto, rescanFaces } from '@/lib/face';

type AdminPhoto = {
  id: string;
  fileName: string;
  width: number;
  height: number;
  faceCount: number;
  /** False for photos imported before face positions were saved. */
  facesLocated: boolean;
  driveFileId?: string;
  createdAt: string;
};

/** Something to import: a Drive photo fetched on demand (its original stays in Drive). */
type Source = { name: string; type: string; driveFileId?: string; load: () => Promise<File> };

const driveSource = (file: DriveFile): Source => ({
  name: file.name,
  type: 'image/jpeg',
  driveFileId: file.id,
  load: () => fetchDriveImage(file),
});

type UploadState = {
  /** A Drive import (default) or a face re-scan of stored photos. */
  kind?: 'import' | 'scan';
  total: number;
  done: number;
  ok: number;
  failed: { name: string; reason: string }[];
  current?: string;
  startedAt?: number;
  /** When the latest photo finished; with startedAt gives the ETA. */
  lastAt?: number;
  /** Neutral status line, e.g. "120 of 1462 already imported". */
  note?: string;
  stopped?: boolean;
};

const ACCEPT = 'image/jpeg,image/png,image/webp';
const PARALLEL_UPLOADS = 3;
/** How many sources to load ahead of face detection (Drive downloads are the slow part). */
const PREFETCH = 3;

export default function EventManager() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [event, setEvent] = useState<AdminEvent | null>(null);
  const [photos, setPhotos] = useState<AdminPhoto[]>([]);
  const [error, setError] = useState('');
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [personId, setPersonId] = useState<string | null>(null);
  const stopRequested = useRef(false);
  const autoSynced = useRef(false);

  const load = useCallback(() => {
    adminFetch<{ event: AdminEvent; photos: AdminPhoto[] }>(`/api/events/${id}`)
      .then((d) => {
        setEvent(d.event);
        setPhotos(d.photos);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(load, [load]);

  const uploading = !!upload?.current;

  // Group faces into people on load, and again whenever an import or scan finishes.
  useEffect(() => {
    if (uploading) return;
    adminFetch<{ people: Person[] }>(`/api/events/${id}/people`)
      .then((d) => {
        setPeople(d.people);
        // Groups are renumbered on each run, so an old selection may now be someone else.
        setPersonId(null);
      })
      .catch(() => {});
  }, [id, uploading]);

  // Warn before leaving mid-import; a Drive sync can take a while.
  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploading]);

  async function syncFromDrive() {
    setUpload({ total: 0, done: 0, ok: 0, failed: [], current: 'Reading the Drive folder…' });
    let listing: { files: DriveFile[]; total: number; alreadyImported: number };
    try {
      listing = await adminFetch(`/api/events/${id}/drive`);
    } catch (e) {
      setUpload({ total: 0, done: 0, ok: 0, failed: [{ name: 'Google Drive', reason: (e as Error).message }] });
      return;
    }
    const note = listing.alreadyImported
      ? `${listing.alreadyImported} of ${listing.total} already imported`
      : `${listing.total} photos in the Drive folder`;
    if (!listing.files.length) {
      setUpload({ total: 0, done: 0, ok: 0, failed: [], note: `Up to date — ${note}` });
      return;
    }
    await uploadSources(listing.files.map(driveSource), note);
  }

  // Arriving from "Create event" with a Drive link: start the first sync automatically.
  useEffect(() => {
    if (!event?.driveFolderId || searchParams.get('sync') !== '1' || autoSynced.current) return;
    autoSynced.current = true;
    router.replace(`/dashboard/${id}`);
    syncFromDrive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.driveFolderId]);

  async function uploadSources(all: Source[], note?: string) {
    const files = all.filter((f) => ACCEPT.split(',').includes(f.type));
    const skipped = all.length - files.length;
    if (!files.length) {
      setUpload({
        total: 0,
        done: 0,
        ok: 0,
        failed: [{ name: 'Selection', reason: 'No JPEG, PNG or WebP images found' }],
      });
      return;
    }
    stopRequested.current = false;
    setUpload({ total: files.length, done: 0, ok: 0, failed: [], note, current: 'Loading face recognition…' });
    try {
      await loadFaceApi();
    } catch {
      setUpload({
        total: files.length,
        done: 0,
        ok: 0,
        failed: [{ name: 'Setup', reason: 'Could not load face models' }],
      });
      return;
    }
    setUpload((u) => u && { ...u, startedAt: Date.now() });

    // Face detection runs one image at a time (it saturates the GPU anyway);
    // uploads overlap with detection of the next image, and the next few
    // sources are loaded (downloaded, for Drive) ahead of time.
    const inFlight = new Set<Promise<void>>();
    const loads = new Map<number, Promise<File>>();
    const prefetch = (i: number) => {
      if (i < files.length && !loads.has(i)) {
        const p = files[i].load();
        p.catch(() => {});
        loads.set(i, p);
      }
    };
    for (let i = 0; i < files.length; i++) {
      if (stopRequested.current) break;
      const source = files[i];
      setUpload((u) => u && { ...u, current: source.name });
      for (let j = i; j <= i + PREFETCH; j++) prefetch(j);
      try {
        const file = await loads.get(i)!;
        loads.delete(i);
        const processed = await processPhoto(file);
        const body = new FormData();
        // Only the record is sent; the image itself stays in Drive.
        body.append(
          'meta',
          JSON.stringify({
            width: processed.width,
            height: processed.height,
            faces: processed.faces,
            boxes: processed.boxes,
            driveFileId: source.driveFileId,
            fileName: source.name,
          }),
        );

        const task = adminFetch<{ photo: AdminPhoto }>(`/api/events/${id}/photos`, { method: 'POST', body })
          .then(({ photo }) => {
            setPhotos((p) => [photo, ...p]);
            setUpload((u) => u && { ...u, done: u.done + 1, lastAt: Date.now(), ok: u.ok + 1 });
          })
          .catch((e: Error) => {
            setUpload(
              (u) =>
                u && {
                  ...u,
                  done: u.done + 1,
                  lastAt: Date.now(),
                  failed: [...u.failed, { name: source.name, reason: e.message }],
                },
            );
          })
          .finally(() => inFlight.delete(task));
        inFlight.add(task);
        if (inFlight.size >= PARALLEL_UPLOADS) await Promise.race(inFlight);
      } catch (e) {
        setUpload(
          (u) =>
            u && {
              ...u,
              done: u.done + 1,
              lastAt: Date.now(),
              failed: [...u.failed, { name: source.name, reason: (e as Error).message }],
            },
        );
      }
    }
    await Promise.all(inFlight);
    setUpload(
      (u) =>
        u && {
          ...u,
          current: undefined,
          stopped: stopRequested.current,
          failed: [
            ...u.failed,
            ...(skipped
              ? [{ name: `${skipped} file(s)`, reason: 'Skipped — only JPEG, PNG and WebP are supported' }]
              : []),
          ],
        },
    );
  }

  /** Re-detect faces on photos imported before positions were saved, using their stored previews. */
  async function scanFaces() {
    const todo = photos.filter((p) => !p.facesLocated);
    if (!todo.length) return;
    const fail = (name: string, reason: string) =>
      setUpload(
        (u) => u && { ...u, done: u.done + 1, lastAt: Date.now(), failed: [...u.failed, { name, reason }] },
      );

    stopRequested.current = false;
    setUpload({ kind: 'scan', total: todo.length, done: 0, ok: 0, failed: [], current: 'Loading face recognition…' });
    try {
      await loadFaceApi();
    } catch {
      setUpload({
        kind: 'scan',
        total: todo.length,
        done: 0,
        ok: 0,
        failed: [{ name: 'Setup', reason: 'Could not load face models' }],
      });
      return;
    }
    setUpload((u) => u && { ...u, startedAt: Date.now() });

    // Detection runs one photo at a time; saving overlaps with detecting the next one.
    const inFlight = new Set<Promise<void>>();
    for (const p of todo) {
      if (stopRequested.current) break;
      setUpload((u) => u && { ...u, current: p.fileName });
      try {
        const scan = await rescanFaces(`/api/photos/${id}/${p.id}?size=preview`);
        const task = adminFetch<{ photo: AdminPhoto }>(`/api/events/${id}/photos/${p.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(scan),
        })
          .then(({ photo }) => {
            setPhotos((ps) => ps.map((x) => (x.id === photo.id ? photo : x)));
            setUpload((u) => u && { ...u, done: u.done + 1, lastAt: Date.now(), ok: u.ok + 1 });
          })
          .catch((e: Error) => fail(p.fileName, e.message))
          .finally(() => inFlight.delete(task));
        inFlight.add(task);
        if (inFlight.size >= PARALLEL_UPLOADS) await Promise.race(inFlight);
      } catch (e) {
        fail(p.fileName, (e as Error).message);
      }
    }
    await Promise.all(inFlight);
    setUpload((u) => u && { ...u, current: undefined, stopped: stopRequested.current });
  }

  async function removeEvent() {
    if (!event || !confirm(`Delete "${event.name}" and all ${photos.length} photos? This cannot be undone.`)) return;
    await adminFetch(`/api/events/${id}`, { method: 'DELETE' });
    router.replace('/dashboard');
  }

  const facesTotal = photos.reduce((n, p) => n + p.faceCount, 0);
  const person = people.find((p) => p.id === personId);
  const personPhotos = person && new Set(person.photoIds);
  const shown = personPhotos ? photos.filter((p) => personPhotos.has(p.id)) : photos;
  const selectPerson = (pid: string | null) => {
    setViewing(null);
    setPersonId(pid);
  };

  return (
    <div className="flex-1 flex flex-col">
      <DashboardHeader />
      <main className="mx-auto w-full max-w-6xl px-5 py-8 flex-1">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> All events
        </Link>

        {error && <p className="mt-6 text-danger">{error}</p>}
        {!event && !error && <div className="mt-6 h-40 rounded-2xl bg-surface-2 animate-pulse" />}

        {event && (
          <>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="font-display text-4xl sm:text-5xl">{event.name}</h1>
                <p className="text-muted mt-1 text-sm">
                  {photos.length} photos · {facesTotal} faces indexed
                  {event.date && ` · ${new Date(event.date).toLocaleDateString()}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setShowSettings((s) => !s)}>
                  <Settings2 className="size-4" /> Settings
                </Button>
                {event.driveFolderId && (
                  <Button variant="secondary" onClick={syncFromDrive} disabled={uploading}>
                    <RefreshCw className="size-4" /> Sync from Drive
                  </Button>
                )}
              </div>
            </div>

            {showSettings && <SettingsPanel event={event} onSaved={setEvent} onDelete={removeEvent} />}

            <SharePanel event={event} />

            {upload && (
              <UploadProgress
                state={upload}
                onDismiss={() => setUpload(null)}
                onStop={() => {
                  stopRequested.current = true;
                }}
              />
            )}

            <PeopleStrip
              eventId={id}
              people={people}
              selected={personId}
              onSelect={selectPerson}
              unscanned={photos.filter((p) => !p.facesLocated).length}
              onScan={scanFaces}
              busy={uploading}
            />

            {person && (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <p className="font-medium">
                  {shown.length} photo{shown.length === 1 ? '' : 's'} of this person
                </p>
                <Button variant="secondary" onClick={() => selectPerson(null)}>
                  Show all photos
                </Button>
              </div>
            )}

            {photos.length === 0 && event.driveFolderId && !upload ? (
              <Card className="mt-8 p-10 text-center">
                <HardDrive className="size-8 mx-auto text-muted" />
                <p className="mt-3 font-medium">Linked to a Google Drive folder</p>
                <p className="text-sm text-muted mt-1">
                  Import its photos and index every face. Keep this tab open while it runs.
                </p>
                <Button className="mt-5" onClick={syncFromDrive}>
                  <RefreshCw className="size-4" /> Sync from Drive
                </Button>
              </Card>
            ) : photos.length === 0 ? (
              <Card className="mt-8 p-10 text-center">
                <HardDrive className="size-8 mx-auto text-muted" />
                <p className="mt-3 font-medium">No photos yet</p>
                <p className="text-sm text-muted mt-1">
                  Add a shared Google Drive folder link in Settings, then sync to import its photos.
                </p>
                <Button variant="secondary" className="mt-5" onClick={() => setShowSettings(true)}>
                  <Settings2 className="size-4" /> Open settings
                </Button>
              </Card>
            ) : (
              <div
                className={`${person ? 'mt-4' : 'mt-8'} grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 rounded-2xl`}
              >
                {shown.map((p, i) => (
                  <div key={p.id} className="group relative aspect-square overflow-hidden rounded-xl bg-surface-2">
                    <button
                      onClick={() => setViewing(i)}
                      className="block size-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                      aria-label={`View ${p.fileName}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/photos/${id}/${p.id}?size=thumb`}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    </button>
                    <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/60 text-white text-xs px-2 py-0.5 backdrop-blur">
                      <Users className="size-3" /> {p.faceCount}
                    </span>
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
                      <a
                        href={`/api/photos/${id}/${p.id}?size=original&download=1`}
                        className="grid place-items-center size-8 rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80"
                        aria-label="Download"
                      >
                        <Download className="size-4" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {viewing !== null && shown[viewing] && (
              <PhotoViewer
                photos={shown.map((p) => ({
                  id: p.id,
                  fileName: p.fileName,
                  preview: `/api/photos/${id}/${p.id}?size=preview`,
                  download: `/api/photos/${id}/${p.id}?size=original&download=1`,
                }))}
                index={viewing}
                onIndex={setViewing}
                onClose={() => setViewing(null)}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function SharePanel({ event }: { event: AdminEvent }) {
  // Only rendered after the event loads client-side, so window is available.
  const url = `${window.location.origin}/g/${event.slug}`;
  const [copied, setCopied] = useState(false);

  const expired = event.expiresAt && new Date(event.expiresAt) < new Date();

  return (
    <Card className="mt-6 p-5 flex flex-col sm:flex-row gap-6 sm:items-center">
      <div className="bg-white p-3 rounded-xl self-start shrink-0">
        {url ? <QRCode value={url} size={112} /> : <div className="size-28" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium">Guest link</p>
        <p className="text-sm text-muted">Guests open this, take a selfie and get their photos.</p>
        <div className="mt-3 flex flex-col sm:flex-row gap-2">
          <code className="flex-1 min-w-0 truncate rounded-xl bg-surface-2 border border-line px-3 h-10 leading-10 text-sm">
            {url}
          </code>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? 'Copied' : 'Copy'}
            </Button>
            <a href={url} target="_blank" rel="noreferrer" className={buttonClass('secondary')}>
              <ExternalLink className="size-4" /> Open
            </a>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">
          {event.hasPassword ? 'Password protected' : 'Anyone with the link'}
          {event.expiresAt && (expired ? ' · Expired' : ` · Expires ${new Date(event.expiresAt).toLocaleString()}`)}
        </p>
      </div>
    </Card>
  );
}

function toLocalInput(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function SettingsPanel({
  event,
  onSaved,
  onDelete,
}: {
  event: AdminEvent;
  onSaved: (e: AdminEvent) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(event.name);
  const [date, setDate] = useState(event.date ?? '');
  const [expiresAt, setExpiresAt] = useState(toLocalInput(event.expiresAt));
  const [password, setPassword] = useState('');
  const [removePassword, setRemovePassword] = useState(false);
  const [driveLink, setDriveLink] = useState(event.driveFolderId ? driveFolderUrl(event.driveFolderId) : '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const body: Record<string, unknown> = {
        name,
        date: date || null,
        expiresAt: expiresAt || null,
        driveFolderUrl: driveLink.trim() || null,
      };
      if (removePassword) body.password = null;
      else if (password) body.password = password;
      const { event: updated } = await adminFetch<{ event: AdminEvent }>(`/api/events/${event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      onSaved({ ...event, ...updated });
      setPassword('');
      setRemovePassword(false);
      setMsg('Saved');
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6 p-6">
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Event name">
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Field label="Event date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Link expires">
          <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </Field>
        <div className="sm:col-span-2 space-y-2">
          <Field
            label={event.hasPassword ? 'Change guest password' : 'Set a guest password'}
            hint={event.hasPassword ? 'Leave empty to keep the current password.' : 'Optional.'}
          >
            <Input
              value={password}
              disabled={removePassword}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
            />
          </Field>
          {event.hasPassword && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={removePassword} onChange={(e) => setRemovePassword(e.target.checked)} />
              Remove password (anyone with the link can search)
            </label>
          )}
        </div>
        <div className="sm:col-span-2">
          <Field
            label="Google Drive folder link"
            hint="Optional. The folder must be shared as “Anyone with the link”. Use Sync from Drive to import."
          >
            <Input
              value={driveLink}
              onChange={(e) => setDriveLink(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/…"
            />
          </Field>
        </div>
        <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3 pt-2">
          <Button type="button" variant="danger" onClick={onDelete}>
            <Trash2 className="size-4" /> Delete event
          </Button>
          <div className="flex items-center gap-3">
            {msg && <span className="text-sm text-muted">{msg}</span>}
            <Button type="submit" disabled={busy}>
              {busy && <Spinner />} Save changes
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

function formatEta(ms: number) {
  const min = Math.round(ms / 60000);
  return min < 1 ? 'under a minute left' : `~${min} min left`;
}

function UploadProgress({
  state,
  onDismiss,
  onStop,
}: {
  state: UploadState;
  onDismiss: () => void;
  onStop: () => void;
}) {
  const pct = state.total ? Math.round((state.done / state.total) * 100) : 100;
  const active = !!state.current;
  const eta =
    active && state.startedAt && state.lastAt && state.done >= 3
      ? formatEta(((state.lastAt - state.startedAt) / state.done) * (state.total - state.done))
      : null;
  return (
    <Card className="mt-6 p-5">
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="font-medium inline-flex items-center gap-2 min-w-0">
          {active && <Spinner className="text-accent" />}
          <span className="truncate">
            {active
              ? state.total
                ? `Processing ${Math.min(state.done + 1, state.total)} of ${state.total} — ${state.current}`
                : state.current
              : state.total
                ? `${state.stopped ? 'Paused' : 'Finished'} — ${state.ok} of ${state.total} ${state.kind === 'scan' ? 'scanned' : 'imported'}`
                : (state.note ?? 'Nothing to import')}
          </span>
        </span>
        {active && state.total > 0 ? (
          <Button variant="ghost" className="h-8" onClick={onStop}>
            <Pause className="size-4" /> Pause
          </Button>
        ) : !active ? (
          <Button variant="ghost" className="h-8" onClick={onDismiss}>
            Dismiss
          </Button>
        ) : null}
      </div>
      {state.total > 0 && (
        <>
          <div className="mt-3 h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">
            {[
              state.note,
              eta,
              active && 'Keep this tab open',
              state.stopped &&
                `${state.kind === 'scan' ? 'Scan' : 'Sync'} again to continue where you left off`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </>
      )}
      {state.failed.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-danger max-h-40 overflow-auto">
          {state.failed.map((f, i) => (
            <li key={i}>
              {f.name}: {f.reason}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
