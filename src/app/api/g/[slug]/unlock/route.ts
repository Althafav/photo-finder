import { grantGuestAccess, verifyPassword } from '@/lib/auth';
import { error, json } from '@/lib/api';
import { getEventBySlug, isExpired } from '@/lib/db';

export async function POST(request: Request, ctx: RouteContext<'/api/g/[slug]/unlock'>) {
  const { slug } = await ctx.params;
  const event = await getEventBySlug(slug);
  if (!event) return error('This gallery does not exist', 404);
  if (isExpired(event)) return error('This gallery link has expired', 410);
  if (!event.passwordHash) return json({ ok: true });

  const { password } = (await request.json().catch(() => ({}))) as { password?: string };
  if (!password || !(await verifyPassword(password, event.passwordHash))) {
    return error('Incorrect password', 401);
  }
  await grantGuestAccess(event.id);
  return json({ ok: true });
}
