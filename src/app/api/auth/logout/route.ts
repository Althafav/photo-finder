import { clearAdminSession } from '@/lib/auth';
import { json } from '@/lib/api';

export async function POST() {
  await clearAdminSession();
  return json({ ok: true });
}
