'use client';

import { ScanFace, Users } from 'lucide-react';
import { Button, cx } from '@/components/ui';

export type Person = {
  id: string;
  photoIds: string[];
  /** Their clearest face (photo + face index); missing until photos have been scanned for face positions. */
  cover?: { photoId: string; face: number };
};

export default function PeopleStrip({
  eventId,
  people,
  selected,
  onSelect,
  unscanned,
  onScan,
  busy,
}: {
  eventId: string;
  people: Person[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Photos imported before face positions were saved. */
  unscanned: number;
  onScan: () => void;
  busy: boolean;
}) {
  if (!people.length && !unscanned) return null;

  return (
    <section className="mt-8" aria-label="People">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-medium">People</h2>
        {people.length > 0 && (
          <p className="text-sm text-muted">{people.length} people in more than one photo</p>
        )}
      </div>

      {unscanned > 0 && (
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
          <p className="text-sm text-muted">
            {unscanned} photo{unscanned === 1 ? ' was' : 's were'} imported before face positions were saved, so
            their faces can&apos;t be shown yet. Scanning re-checks the preview copies stored on this server,
            so nothing is fetched from Google Drive again.
          </p>
          <Button variant="secondary" className="shrink-0" onClick={onScan} disabled={busy}>
            <ScanFace className="size-4" /> Scan faces
          </Button>
        </div>
      )}

      {people.length > 0 && (
        <div className="mt-4 -mx-5 px-5 flex gap-4 overflow-x-auto pb-2 [scrollbar-width:thin]">
          {people.map((p) => {
            const active = selected === p.id;
            return (
              <button
                key={p.id}
                onClick={() => onSelect(active ? null : p.id)}
                aria-pressed={active}
                aria-label={`${p.photoIds.length} photos of this person`}
                className="group shrink-0 flex flex-col items-center gap-1.5 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
              >
                <span
                  className={cx(
                    'relative block size-16 overflow-hidden rounded-full bg-surface-2 transition',
                    active ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg' : 'group-hover:ring-2 group-hover:ring-line',
                  )}
                >
                  {p.cover ? (
                    // A ~5 KB crop made on the server, not the whole photo.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/events/${eventId}/faces/${p.cover.photoId}?face=${p.cover.face}`}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    <Users className="absolute inset-0 m-auto size-6 text-muted" />
                  )}
                </span>
                <span className={cx('text-xs tabular-nums', active ? 'text-fg font-medium' : 'text-muted')}>
                  {p.photoIds.length}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
