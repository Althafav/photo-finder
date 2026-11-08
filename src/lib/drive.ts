'use client';

// Fetches photos from a public Google Drive folder straight into the browser.
// Google serves resized copies with open CORS, so no API key or sign-in is
// needed; the full-size originals stay in Drive.

import { driveImageUrl } from '@/lib/drive-image';

export type DriveFile = { id: string; name: string };

/** Longest side to fetch: what face detection uses (DETECT_SIZE in face.ts); nothing larger is kept. */
const SIZE = 1280;

const RETRIES = 3;

export async function fetchDriveImage(file: DriveFile) {
  const url = driveImageUrl(file.id, SIZE);
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    // Google answers 429 to requests that carry our page as the referrer (hotlink protection).
    res = await fetch(url, { referrerPolicy: 'no-referrer', credentials: 'omit' });
    if (res.ok || attempt >= RETRIES || (res.status !== 429 && res.status < 500)) break;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  if (!res.ok) throw new Error(`Drive download failed (${res.status})`);
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) throw new Error('Drive did not return an image');
  return new File([blob], file.name, { type: blob.type });
}

export const driveFolderUrl = (folderId: string) => `https://drive.google.com/drive/folders/${folderId}`;
