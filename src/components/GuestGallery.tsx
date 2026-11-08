'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Camera, Check, ImageUp, Lock, RefreshCw, ScanFace, SearchX, ShieldCheck, X } from 'lucide-react';
import PhotoViewer from '@/components/PhotoViewer';
import { Button, Card, cx, Input, Logo, Spinner } from '@/components/ui';
import { faceApiReady, loadFaceApi, nextPaint, selfieDescriptor, warmUpFaceApi } from '@/lib/face';

type GuestEvent = {
  name: string;
  date?: string;
  photoCount: number;
  requiresPassword: boolean;
  unlocked: boolean;
};

type Photo = {
  id: string;
  fileName: string;
  width: number;
  height: number;
  thumb: string;
  preview: string;
  download: string;
};

type Match = Photo & { distance: number };

type Stage = 'loading' | 'error' | 'locked' | 'gallery';

/** Steps of a face search, in order. */
type MatchPhase = 'preparing' | 'finding' | 'searching';

/** Shortest time "Finding your face" stays up, from when the photo is shown. */
const MIN_FIND_MS = 2000;
/** Shortest time the whole scan runs before results appear (asked for 3–5 s). */
const MIN_SCAN_MS = 3500;

/** Slider presets: max face distance to count as "you". Lower = stricter. */
const SENSITIVITY = [
  { label: 'Strict', value: 0.45 },
  { label: 'Balanced', value: 0.52 },
  { label: 'Loose', value: 0.6 },
];

/** Thumbnails added to the grid per scroll step — big events have 1,000+ photos. */
const PAGE = 60;

export default function GuestGallery() {
  const { slug } = useParams<{ slug: string }>();
  const [stage, setStage] = useState<Stage>('loading');
  const [event, setEvent] = useState<GuestEvent | null>(null);
  const [error, setError] = useState('');
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  /** null = no face search yet: show every photo. */
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [level, setLevel] = useState(1);
  const [finding, setFinding] = useState(false);
  /** Which step of the face search is running; null when idle. */
  const [phase, setPhase] = useState<MatchPhase | null>(null);
  /** The steps this search goes through (model loading is skipped once it's done). */
  const [phases, setPhases] = useState<MatchPhase[]>([]);
  const matching = phase !== null;
  const [selfieError, setSelfieError] = useState('');
  const [selfieUrl, setSelfieUrl] = useState('');

  const loadPhotos = useCallback(async () => {
    const res = await fetch(`/api/g/${slug}/photos`);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      setStage('locked');
      return;
    }
    if (!res.ok) {
      setError(data.error ?? 'Could not load the photos');
      setStage('error');
      return;
    }
    setPhotos(data.photos);
    setStage('gallery');
  }, [slug]);

  useEffect(() => {
    fetch(`/api/g/${slug}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Could not open this gallery');
        setEvent(data.event);
        if (data.event.requiresPassword && !data.event.unlocked) setStage('locked');
        else await loadPhotos();
      })
      .catch((e) => {
        setError(e.message);
        setStage('error');
      });
    // Download the models while the guest browses (network only, no stutter).
    loadFaceApi().catch(() => {});
  }, [slug, loadPhotos]);

  // The heavier GPU warm-up starts once the guest opens the selfie panel, while they pick a photo.
  const openFinder = () => {
    setFinding(true);
    warmUpFaceApi().catch(() => {});
  };

  const runMatch = useCallback(
    async (canvas: HTMLCanvasElement) => {
      const needsModels = !faceApiReady();
      setPhases(needsModels ? ['preparing', 'finding', 'searching'] : ['finding', 'searching']);
      setSelfieError('');
      setSelfieUrl(canvas.toDataURL('image/jpeg', 0.8));
      // Set the first step right away so "Opening your photo" hands straight over to it.
      setPhase(needsModels ? 'preparing' : 'finding');
      // Once warm, a search takes ~0.3 s; hold each step so the scan reads as deliberate
      // (~3.5 s in all). Slower work isn't padded further.
      const started = performance.now();
      const holdUntil = (ms: number) =>
        new Promise((r) => setTimeout(r, Math.max(0, started + ms - performance.now())));
      try {
        // Each step is drawn before its work starts: face detection blocks the page while it runs.
        if (needsModels) {
          await nextPaint();
          try {
            await warmUpFaceApi();
          } catch {
            throw new Error("Face recognition couldn't load. Check your connection and try again.");
          }
        }
        setPhase('finding');
        await nextPaint();
        const descriptor = await selfieDescriptor(canvas);
        await holdUntil(MIN_FIND_MS);
        if (!descriptor) {
          setSelfieError(
            "We couldn't find a face in this photo. Use one where your face is clear, facing the camera, in good light.",
          );
          return;
        }
        setPhase('searching');
        const res = await fetch(`/api/g/${slug}/match`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ descriptor }),
        });
        const data = await res.json();
        if (res.status === 401) {
          setFinding(false);
          setStage('locked');
          return;
        }
        if (!res.ok) throw new Error(data.error ?? 'The search failed. Try again.');
        await holdUntil(MIN_SCAN_MS);
        setMatches(data.matches);
        setFinding(false);
        // Results replace the grid in place; bring the guest back up to see the count and controls.
        window.scrollTo({ top: 0 });
      } catch (e) {
        setSelfieError((e as Error).message);
      } finally {
        setPhase(null);
      }
    },
    [slug],
  );

  const shown = matches ? matches.filter((m) => m.distance <= SENSITIVITY[level].value) : (photos ?? []);

  return (
    <div className="flex-1 flex flex-col">
      <header className="mx-auto w-full max-w-6xl px-5 h-16 flex items-center justify-between">
        <Logo />
        {event && (
          <span className="text-sm text-muted truncate ml-4">{photos?.length ?? event.photoCount} photos</span>
        )}
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 pb-16 flex-1">
        {stage === 'loading' && (
          <div className="py-32 grid place-items-center">
            <Spinner className="size-6 text-accent" />
          </div>
        )}

        {stage === 'error' && (
          <div className="py-24 text-center max-w-md mx-auto">
            <SearchX className="size-10 mx-auto text-muted" />
            <h1 className="font-display text-4xl mt-4">Gallery unavailable</h1>
            <p className="text-muted mt-2">{error}</p>
          </div>
        )}

        {event && (stage === 'locked' || stage === 'gallery') && (
          <div className="pt-6 sm:pt-12 text-center">
            <p className="text-sm text-accent font-medium">
              {event.date ? new Date(event.date).toLocaleDateString(undefined, { dateStyle: 'long' }) : 'Event gallery'}
            </p>
            <h1 className="font-display text-4xl sm:text-6xl mt-2 leading-tight">{event.name}</h1>
          </div>
        )}

        {stage === 'locked' && <PasswordGate slug={slug} onUnlocked={loadPhotos} />}

        {stage === 'gallery' && photos && (
          <>
            {matches ? (
              <MatchBar
                count={shown.length}
                selfieUrl={selfieUrl}
                level={level}
                onLevel={setLevel}
                onRetry={openFinder}
                onClear={() => setMatches(null)}
              />
            ) : (
              <div className="mt-6 flex justify-center">
                <Button className="h-12 px-6 text-base" onClick={openFinder} disabled={!photos.length}>
                  <ScanFace className="size-5" /> Find my photos
                </Button>
              </div>
            )}

            {shown.length === 0 ? (
              <Card className="mt-8 p-10 text-center">
                <SearchX className="size-8 mx-auto text-muted" />
                <p className="mt-3 text-muted max-w-sm mx-auto">
                  {!matches
                    ? 'No photos here yet. The photographer may still be importing them.'
                    : matches.length
                      ? 'Try the Loose setting to see more possible matches.'
                      : 'Try a clearer selfie facing the camera, or browse all photos.'}
                </p>
              </Card>
            ) : (
              <PhotoGrid key={matches ? `match-${level}` : 'all'} photos={shown} />
            )}
          </>
        )}
      </main>

      {finding && (
        <SelfieDialog onClose={() => !matching && setFinding(false)}>
          <SelfieCapture
            phase={phase}
            phases={phases}
            photoCount={photos?.length ?? 0}
            error={selfieError}
            onCapture={runMatch}
            selfieUrl={selfieUrl}
          />
        </SelfieDialog>
      )}
    </div>
  );
}

function MatchBar({
  count,
  selfieUrl,
  level,
  onLevel,
  onRetry,
  onClear,
}: {
  count: number;
  selfieUrl: string;
  level: number;
  onLevel: (i: number) => void;
  onRetry: () => void;
  onClear: () => void;
}) {
  return (
    <div className="mt-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        {selfieUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={selfieUrl} alt="" className="size-12 rounded-full object-cover border-2 border-accent" />
        )}
        <div>
          <p className="font-medium">
            {count ? `${count} photo${count === 1 ? '' : 's'} of you` : 'No photos of you found'}
          </p>
          <button onClick={onRetry} className="text-sm text-muted hover:text-fg inline-flex items-center gap-1">
            <RefreshCw className="size-3.5" /> Try another selfie
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex rounded-full border border-line bg-surface p-1"
          role="radiogroup"
          aria-label="Match sensitivity"
        >
          {SENSITIVITY.map((s, i) => (
            <button
              key={s.label}
              role="radio"
              aria-checked={level === i}
              onClick={() => onLevel(i)}
              className={cx(
                'px-3.5 h-8 rounded-full text-sm transition',
                level === i ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <Button variant="secondary" onClick={onClear}>
          Show all photos
        </Button>
      </div>
    </div>
  );
}

/** Masonry grid that adds thumbnails as the guest scrolls, with a full-screen viewer. */
function PhotoGrid({ photos }: { photos: Photo[] }) {
  const [visible, setVisible] = useState(PAGE);
  const [open, setOpen] = useState<number | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const hasMore = visible < photos.length;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setVisible((v) => v + PAGE),
      { rootMargin: '800px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, visible]);

  return (
    <>
      <div className="mt-8 columns-2 sm:columns-3 lg:columns-4 gap-3 [&>*]:mb-3">
        {photos.slice(0, visible).map((p, i) => (
          <button
            key={p.id}
            onClick={() => setOpen(i)}
            className="block w-full overflow-hidden rounded-xl bg-surface-2 break-inside-avoid focus-visible:outline-2 focus-visible:outline-accent"
            style={{ aspectRatio: p.width && p.height ? `${p.width} / ${p.height}` : '1' }}
            aria-label={`View ${p.fileName}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.thumb} alt="" loading="lazy" className="size-full object-cover hover:scale-[1.02] transition" />
          </button>
        ))}
      </div>
      {hasMore && <div ref={sentinel} className="h-px" />}

      {open !== null && photos[open] && (
        <PhotoViewer
          photos={photos}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

/** Bottom sheet on phones, centred dialog on larger screens. */
function SelfieDialog({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Find your photos"
        className="relative w-full sm:max-w-md max-h-[94dvh] overflow-y-auto bg-bg rounded-t-3xl sm:rounded-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 grid place-items-center size-9 rounded-full bg-surface-2 text-muted hover:text-fg"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
        {children}
      </div>
    </div>
  );
}

function PasswordGate({ slug, onUnlocked }: { slug: string; onUnlocked: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch(`/api/g/${slug}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) onUnlocked();
    else setError((await res.json().catch(() => ({}))).error ?? 'Incorrect password');
    setBusy(false);
  }

  return (
    <Card className="mt-10 p-6 max-w-sm mx-auto">
      <Lock className="size-6 text-accent" />
      <h2 className="mt-3 text-lg font-medium">This gallery is private</h2>
      <p className="text-sm text-muted">Enter the password the photographer shared with you.</p>
      <form onSubmit={submit} className="mt-5 space-y-3">
        <Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" className="w-full h-11" disabled={busy || !password}>
          {busy && <Spinner />} Unlock
        </Button>
      </form>
    </Card>
  );
}

const PHASE_LABEL: Record<MatchPhase, (photoCount: number) => string> = {
  preparing: () => 'Getting face recognition ready',
  finding: () => 'Finding your face',
  searching: (n) => `Searching ${n.toLocaleString()} photos`,
};

/** The steps of a search, ticked off as they finish. */
function SearchSteps({ phase, phases, photoCount }: { phase: MatchPhase; phases: MatchPhase[]; photoCount: number }) {
  const current = phases.indexOf(phase);
  return (
    <ol className="space-y-2.5 text-sm" aria-live="polite">
      {phases.map((p, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={p}
            className={cx('flex items-center gap-2.5', active ? 'text-white' : done ? 'text-white/75' : 'text-white/45')}
          >
            <span className="grid place-items-center size-5 shrink-0">
              {done ? (
                <Check className="size-4" />
              ) : active ? (
                <Spinner className="size-4" />
              ) : (
                <span className="size-1.5 rounded-full bg-current" />
              )}
            </span>
            <span className={cx(active && 'font-medium')}>
              {PHASE_LABEL[p](photoCount)}
              {active && p === 'preparing' && (
                <span className="block text-xs font-normal text-white/70">Only the first time, a few seconds</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function SelfieCapture({
  phase,
  phases,
  photoCount,
  error,
  onCapture,
  selfieUrl,
}: {
  phase: MatchPhase | null;
  phases: MatchPhase[];
  photoCount: number;
  error: string;
  onCapture: (canvas: HTMLCanvasElement) => void;
  selfieUrl: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState<'off' | 'starting' | 'on' | 'denied'>('off');
  /** The picked file, shown at once while it's being decoded. */
  const [picked, setPicked] = useState('');
  const [fileError, setFileError] = useState('');
  const busy = phase !== null || !!picked;

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  async function startCamera() {
    setFileError('');
    setCamera('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      setCamera('on');
      // The <video> mounts once camera === 'on'.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch {
      setCamera('denied');
    }
  }

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    stopCamera();
    setCamera('off');
    onCapture(canvas);
  }

  async function fromFile(file: File) {
    setFileError('');
    // Show the photo straight away; decoding a large phone photo can take a second or two.
    const url = URL.createObjectURL(file);
    setPicked(url);
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
      if (!bitmap) {
        setFileError("This photo couldn't be opened. Try a JPEG or PNG, or use the camera.");
        return;
      }
      const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      onCapture(canvas);
    } finally {
      URL.revokeObjectURL(url);
      setPicked('');
    }
  }

  const shownError = fileError || (!busy ? error : '');
  // Keep the selfie in view while searching and after a failed search, so the guest sees what went wrong.
  const photo = picked || ((phase || error) && !fileError ? selfieUrl : '');

  return (
    <div>
      <div className="relative aspect-[3/4] max-h-[52dvh] w-full rounded-2xl overflow-hidden bg-surface border border-line">
        {camera === 'on' ? (
          <video ref={videoRef} playsInline muted className="size-full object-cover -scale-x-100" />
        ) : photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="Your selfie" className="size-full object-cover" />
        ) : (
          <div className="size-full grid place-items-center p-8 text-center">
            <div>
              <ScanFace className="size-14 mx-auto text-accent" strokeWidth={1.5} />
              <p className="mt-4 text-lg font-medium">Find your photos</p>
              <p className="text-sm text-muted mt-1">
                Take a quick selfie and we&apos;ll show every photo you appear in.
              </p>
            </div>
          </div>
        )}

        {/* Face guide */}
        {camera === 'on' && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="w-3/5 aspect-[3/4] rounded-[50%] border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        )}

        {/* Scanning the photo: a glowing line with a soft trail sweeps up and down over it.
            The full-height layer moves by its own height, so the line at its top travels
            the photo. Reduced motion gets a still frame around the photo instead. */}
        {(phase || picked) && (
          <>
            <div className="pointer-events-none absolute inset-x-0 -top-full h-full hidden motion-safe:block motion-safe:animate-scan">
              <div className="absolute inset-x-0 bottom-0 h-24 bg-linear-to-b from-transparent to-accent/25" />
              <div className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-white shadow-[0_0_14px_3px_var(--accent)]" />
            </div>
            <div className="pointer-events-none absolute inset-3 rounded-xl border-2 border-white/60 motion-safe:hidden" />
          </>
        )}

        {(picked || phase) && (
          <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 via-black/55 to-transparent px-5 pb-5 pt-16 text-white">
            {phase ? (
              <SearchSteps phase={phase} phases={phases} photoCount={photoCount} />
            ) : (
              <p className="flex items-center gap-2.5 text-sm font-medium" aria-live="polite">
                <Spinner className="size-4" /> Opening your photo
              </p>
            )}
          </div>
        )}
      </div>

      {shownError && (
        <p className="mt-4 text-sm text-danger text-center" role="alert">
          {shownError}
        </p>
      )}
      {camera === 'denied' && (
        <p className="mt-4 text-sm text-danger text-center" role="alert">
          Camera access was blocked. Allow it in your browser, or upload a selfie instead.
        </p>
      )}

      <div className="mt-5 flex flex-col gap-2">
        {camera === 'on' ? (
          <Button className="h-12 text-base" onClick={capture}>
            <Camera className="size-5" /> Take selfie
          </Button>
        ) : (
          <Button className="h-12 text-base" onClick={startCamera} disabled={busy || camera === 'starting'}>
            {camera === 'starting' ? <Spinner /> : <Camera className="size-5" />}
            {shownError ? 'Try again with the camera' : 'Use camera'}
          </Button>
        )}
        <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
          <ImageUp className="size-4" /> {shownError ? 'Upload a different photo' : 'Upload a selfie instead'}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) fromFile(f);
            e.target.value = '';
          }}
        />
      </div>

      <p className="mt-5 flex gap-2 text-xs text-muted justify-center text-center">
        <ShieldCheck className="size-4 shrink-0" />
        Your selfie is analysed on this device and is never uploaded or stored.
      </p>
    </div>
  );
}
