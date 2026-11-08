import { error, json, requireAdmin } from '@/lib/api';
import { listPublicFolder, parseFolderId } from '@/lib/drive-public';

/** Check a pasted folder link: `?url=<Drive folder link>`. */
export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const folderId = parseFolderId(new URL(request.url).searchParams.get('url') ?? '');
  if (!folderId) return error("That doesn't look like a Google Drive folder link", 400);
  try {
    const { title, files } = await listPublicFolder(folderId);
    return json({ folderId, title, count: files.length });
  } catch (e) {
    return error((e as Error).message, 422);
  }
}
