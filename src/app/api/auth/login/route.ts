import { checkAdminPassword, setAdminSession } from '@/lib/auth';
import { error, json } from '@/lib/api';

export async function POST(request: Request) {
  const { password } = (await request.json().catch(() => ({}))) as { password?: string };
  if (!password || !checkAdminPassword(password)) return error('Wrong password', 401);
  await setAdminSession();
  return json({ ok: true });
}
