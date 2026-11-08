'use client';

// Browser-side face detection. Models are served from /public/models and the
// library is loaded lazily so it never runs on the server.

type FaceApi = typeof import('@vladmandic/face-api');

let loading: Promise<FaceApi> | null = null;
let warming: Promise<FaceApi> | null = null;
let ready = false;

/** True once the models are loaded and warmed up, so a search can skip its "getting ready" step. */
export const faceApiReady = () => ready;

export function loadFaceApi() {
  loading ??= (async () => {
    const faceapi = await import('@vladmandic/face-api');
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
      faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
    ]);
    return faceapi;
  })().catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

/**
 * Load the models and run each once on a blank image. The first real run compiles
 * GPU programs and blocks the page for several seconds — better while the guest is
 * still choosing a photo than while they wait for results.
 */
export function warmUpFaceApi() {
  warming ??= (async () => {
    const faceapi = await loadFaceApi();
    const blank = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h });
    // Each model directly: on a blank image the normal chain stops after detection finds no face.
    await faceapi.detectAllFaces(blank(640, 480), new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45 }));
    await faceapi.detectFaceLandmarks(blank(150, 150));
    await faceapi.computeFaceDescriptor(blank(150, 150));
    ready = true;
    return faceapi;
  })().catch((err) => {
    warming = null;
    throw err;
  });
  return warming;
}

/**
 * Let the browser draw pending updates before heavy work blocks the page.
 * Hidden pages never draw a frame, so don't wait more than 100 ms for one.
 */
export const nextPaint = () =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 100);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      setTimeout(resolve, 0);
    });
  });

/** Longest side used for face detection; plenty for faces, much faster than full-res. */
const DETECT_SIZE = 1280;

function drawScaled(source: CanvasImageSource, w: number, h: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export type ProcessedPhoto = {
  width: number;
  height: number;
  faces: number[][];
  /** [x, y, w, h] of each face as fractions of the photo, same order as faces. */
  boxes: number[][];
};

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Every face in an image: its descriptor and where it sits (as fractions of the image). */
async function detectFaces(canvas: HTMLCanvasElement) {
  const faceapi = await loadFaceApi();
  const detections = await faceapi
    .detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
  // Faces with almost no usable pixels (cut off at the edge, tiny) can yield NaN
  // descriptors, which the server rejects. Skip them so the rest of the photo still imports.
  const usable = detections.filter((d) => d.descriptor.every(Number.isFinite));
  return {
    faces: usable.map((d) => Array.from(d.descriptor)),
    boxes: usable.map(({ detection: { box } }) => [
      round4(box.x / canvas.width),
      round4(box.y / canvas.height),
      round4(box.width / canvas.width),
      round4(box.height / canvas.height),
    ]),
  };
}

/** Re-detect faces from an image URL (the photo's Drive copy), at the same size imports use. */
export async function rescanFaces(url: string) {
  // The URL redirects to Google Drive, which refuses requests that name our page as referrer.
  const res = await fetch(url, { referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error(`Could not load the photo (${res.status})`);
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = drawScaled(bitmap, bitmap.width, bitmap.height, DETECT_SIZE);
  bitmap.close();
  return detectFaces(canvas);
}

/** Read a photo's size and find every face in it. The image itself isn't kept — it stays in Drive. */
export async function processPhoto(file: File): Promise<ProcessedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This browser cannot read this image format');
  }
  const { width, height } = bitmap;

  const detectCanvas = drawScaled(bitmap, width, height, DETECT_SIZE);
  bitmap.close();

  const { faces, boxes } = await detectFaces(detectCanvas);
  return { width, height, faces, boxes };
}

/** Descriptor of the largest face in a selfie, or null if none was found. */
export async function selfieDescriptor(source: HTMLCanvasElement | HTMLImageElement) {
  const faceapi = await loadFaceApi();
  const detections = await faceapi
    .detectAllFaces(source, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
  if (!detections.length) return null;
  const largest = detections.reduce((a, b) => (b.detection.box.area > a.detection.box.area ? b : a));
  return Array.from(largest.descriptor);
}
