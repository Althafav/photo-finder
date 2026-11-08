'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, Check, HardDrive, ImageIcon, Lock, Plus, X } from 'lucide-react';
import { adminFetch, DashboardHeader, type AdminEvent } from '@/components/DashboardHeader';
import { Button, Card, cx, Field, Input, Spinner } from '@/components/ui';

export default function DashboardPage() {
  const router = useRouter();
  const [events, setEvents] = useState<AdminEvent[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    adminFetch<{ events: AdminEvent[] }>('/api/events')
      .then((d) => setEvents(d.events))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="flex-1 flex flex-col">
      <DashboardHeader />
      <main className="mx-auto w-full max-w-6xl px-5 py-10 flex-1">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="font-display text-4xl sm:text-5xl">Your events</h1>
            <p className="text-muted mt-1">Each event gets its own guest link and QR code.</p>
          </div>
          {!creating && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New event
            </Button>
          )}
        </div>

        {creating && (
          <NewEventForm
            onCancel={() => setCreating(false)}
            onCreated={(e) => router.push(`/dashboard/${e.id}${e.driveFolderId ? '?sync=1' : ''}`)}
          />
        )}

        {error && <p className="text-danger">{error}</p>}
        {!events && !error && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-36 rounded-2xl bg-surface-2 animate-pulse" />
            ))}
          </div>
        )}
        {events?.length === 0 && !creating && (
          <Card className="p-10 text-center">
            <ImageIcon className="size-8 mx-auto text-muted" />
            <p className="mt-3 font-medium">No events yet</p>
            <p className="text-sm text-muted">Create your first event to start uploading photos.</p>
          </Card>
        )}
        {events && events.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((e) => (
              <Link key={e.id} href={`/dashboard/${e.id}`}>
                <Card className="p-5 h-full hover:border-accent transition">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-medium text-lg leading-snug">{e.name}</h2>
                    <span className="flex gap-1.5 shrink-0 mt-1 text-muted">
                      {e.driveFolderId && <HardDrive className="size-4" aria-label="Synced from Google Drive" />}
                      {e.hasPassword && <Lock className="size-4" aria-label="Password protected" />}
                    </span>
                  </div>
                  <div className="mt-6 flex items-center gap-4 text-sm text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <ImageIcon className="size-4" /> {e.photoCount ?? 0} photos
                    </span>
                    {e.date && (
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarDays className="size-4" /> {new Date(e.date).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function NewEventForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (e: AdminEvent) => void }) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [password, setPassword] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [driveLink, setDriveLink] = useState('');
  const [drive, setDrive] = useState<{ state: 'idle' | 'checking' | 'ok' | 'error'; message?: string }>({
    state: 'idle',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function checkDrive(link: string) {
    if (!link.trim()) {
      setDrive({ state: 'idle' });
      return;
    }
    setDrive({ state: 'checking' });
    try {
      const folder = await adminFetch<{ title: string; count: number }>(
        `/api/drive/folder?url=${encodeURIComponent(link.trim())}`,
      );
      setDrive({ state: 'ok', message: `${folder.count.toLocaleString()} photos found` });
      if (folder.title) setName((n) => n || folder.title);
    } catch (e) {
      setDrive({ state: 'error', message: (e as Error).message });
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { event } = await adminFetch<{ event: AdminEvent }>('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, date, password, expiresAt, driveFolderUrl: driveLink.trim() || undefined }),
      });
      onCreated(event);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card className="p-6 mb-8">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-medium">New event</h2>
        <Button variant="ghost" className="px-2" onClick={onCancel} aria-label="Cancel">
          <X className="size-4" />
        </Button>
      </div>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field
            label="Google Drive folder link"
            hint="Optional. Paste a folder shared as “Anyone with the link” and its photos are imported automatically."
          >
            <Input
              autoFocus
              value={driveLink}
              onChange={(e) => setDriveLink(e.target.value)}
              onBlur={(e) => checkDrive(e.target.value)}
              onPaste={(e) => checkDrive(e.clipboardData.getData('text'))}
              placeholder="https://drive.google.com/drive/folders/…"
            />
          </Field>
          {drive.state !== 'idle' && (
            <p
              className={cx(
                'mt-1.5 text-sm inline-flex items-center gap-1.5',
                drive.state === 'error' ? 'text-danger' : drive.state === 'ok' ? 'text-ok' : 'text-muted',
              )}
            >
              {drive.state === 'checking' ? <Spinner /> : drive.state === 'ok' ? <Check className="size-4" /> : null}
              {drive.state === 'checking' ? 'Checking folder…' : drive.message}
            </p>
          )}
        </div>
        <div className="sm:col-span-2">
          <Field label="Event name">
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sara & Omar's wedding"
            />
          </Field>
        </div>
        <Field label="Event date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Link expires" hint="Optional. Guests can't open the gallery after this.">
          <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Guest password" hint="Optional. Leave empty to let anyone with the link search.">
            <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
          </Field>
        </div>
        {error && <p className="text-sm text-danger sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2 flex gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={busy || !name.trim() || drive.state === 'checking' || drive.state === 'error'}
          >
            {busy && <Spinner />} Create event
          </Button>
        </div>
      </form>
    </Card>
  );
}
