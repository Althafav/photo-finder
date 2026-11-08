import 'server-only';

// Lists a Google Drive folder shared as "Anyone with the link" — no API key or
// sign-in. It reads Drive's embeddable folder view, which is an undocumented
// page: if Google changes its markup, listing here is what breaks.

export type DriveFile = { id: string; name: string };

const ID = /^[\w-]{10,100}$/;
const IMAGE = /\.(jpe?g|png|webp)$/i;
const MAX_DEPTH = 3;

/** Accepts a folder URL in any common form, or a bare folder id. */
export function parseFolderId(input: string) {
  const s = input.trim();
  const match = s.match(/\/folders\/([\w-]+)/) ?? s.match(/[?&]id=([\w-]+)/);
  const id = match ? match[1] : s;
  return ID.test(id) ? id : null;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

async function fetchFolder(folderId: string) {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${folderId}`, {
    headers: { 'Accept-Language': 'en' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? 'Folder not found. Check the link.'
        : "Can't open this folder. Make sure it's shared as “Anyone with the link”.",
    );
  }
  const html = await res.text();
  if (!html.includes('flip-entries') && !html.includes('flip-entry')) {
    throw new Error("Can't open this folder. Make sure it's shared as “Anyone with the link”.");
  }

  const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '').trim();
  const files: DriveFile[] = [];
  const folders: string[] = [];
  // Each entry: <div class="flip-entry" id="entry-ID"> … <a href="…/file/d/ID/…|…/folders/ID"> … flip-entry-title">NAME<
  for (const block of html.split('class="flip-entry" id="entry-').slice(1)) {
    const id = block.match(/^([\w-]+)"/)?.[1];
    const name = decode(block.match(/flip-entry-title">([^<]*)</)?.[1] ?? '').trim();
    if (!id) continue;
    if (/href="[^"]*\/folders\//.test(block.slice(0, 400))) folders.push(id);
    else if (IMAGE.test(name)) files.push({ id, name });
  }
  return { title, files, folders };
}

export async function listPublicFolder(folderId: string) {
  const root = await fetchFolder(folderId);
  const seen = new Map(root.files.map((f) => [f.id, f]));

  let queue = root.folders.map((id) => ({ id, depth: 1 }));
  while (queue.length) {
    const level = await Promise.all(
      queue.map(async ({ id, depth }) => ({ depth, folder: await fetchFolder(id).catch(() => null) })),
    );
    queue = [];
    for (const { depth, folder } of level) {
      if (!folder) continue;
      for (const f of folder.files) seen.set(f.id, f);
      if (depth < MAX_DEPTH) queue.push(...folder.folders.map((id) => ({ id, depth: depth + 1 })));
    }
  }

  const files = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { folderId, title: root.title, files };
}
