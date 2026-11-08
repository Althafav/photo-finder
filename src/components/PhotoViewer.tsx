'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Maximize, Minimize, X } from 'lucide-react';
import { cx } from '@/components/ui';

/** What the viewer needs to show and download one photo. */
export type ViewerPhoto = { id: string; fileName: string; preview: string; download: string };

/** Edge-to-edge photo viewer: arrows/keys/swipe to move, optional true browser full screen. */
export default function PhotoViewer({
  photos,
  index,
  onIndex,
  onClose,
}: {
  photos: ViewerPhoto[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const photo = photos[index];
  const prev = index > 0 ? () => onIndex(index - 1) : undefined;
  const next = index < photos.length - 1 ? () => onIndex(index + 1) : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) onClose();
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      if (e.key === 'ArrowRight' && index < photos.length - 1) onIndex(index + 1);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose, onIndex, index, photos.length]);

  // Track browser full screen (the guest can also leave it with Esc), and leave it when the viewer closes.
  useEffect(() => {
    const sync = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  // Preload neighbours so swiping feels instant.
  useEffect(() => {
    for (const p of [photos[index - 1], photos[index + 1]]) if (p) new Image().src = p.preview;
  }, [photos, index]);

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else rootRef.current?.requestFullscreen().catch(() => {});
  }

  const round = 'place-items-center size-11 rounded-full bg-black/50 text-white hover:bg-black/70 transition';
  const iconBtn = cx('grid', round);
  // Phones swipe instead, so the side arrows only show from sm up.
  const arrowBtn = cx('hidden sm:grid absolute top-1/2 -translate-y-1/2', round);

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-50 bg-black select-none"
      role="dialog"
      aria-modal="true"
      aria-label={photo.fileName}
      onTouchStart={(e) => {
        touchX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (dx > 50) prev?.();
        if (dx < -50) next?.();
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center" onClick={onClose}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={photo.id}
          src={photo.preview}
          alt={photo.fileName}
          className="max-h-full max-w-full object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3 text-white pointer-events-none [&>*]:pointer-events-auto">
        <span className="rounded-full bg-black/50 px-3 py-1.5 text-sm tabular-nums">
          {index + 1} of {photos.length}
        </span>
        <div className="flex gap-2">
          <a href={photo.download} className={iconBtn} aria-label="Download original">
            <Download className="size-5" />
          </a>
          {typeof document !== 'undefined' && document.fullscreenEnabled && (
            <button
              onClick={toggleFullscreen}
              className={iconBtn}
              aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
            >
              {fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
            </button>
          )}
          <button onClick={onClose} className={iconBtn} aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
      </div>

      {prev && (
        <button
          onClick={prev}
          className={cx(arrowBtn, 'left-3')}
          aria-label="Previous photo"
        >
          <ChevronLeft className="size-6" />
        </button>
      )}
      {next && (
        <button
          onClick={next}
          className={cx(arrowBtn, 'right-3')}
          aria-label="Next photo"
        >
          <ChevronRight className="size-6" />
        </button>
      )}
    </div>
  );
}
