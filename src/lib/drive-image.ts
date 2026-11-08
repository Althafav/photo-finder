// Addresses of the resized copies Google serves for files in a public Drive folder.
// Usable on the server and in the browser. Google refuses these requests (429) when
// they carry another site as the referrer, so callers must not send one.

/** Longest side, in pixels, for each size the app shows. */
export const DRIVE_SIZES = { thumb: 560, preview: 2048 } as const;

/** A copy of the photo whose longest side is `size` px (never upscaled). */
export const driveImageUrl = (fileId: string, size: number) =>
  `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}=s${size}`;

/** The full-size original, as a download. */
export const driveDownloadUrl = (fileId: string) =>
  `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`;
