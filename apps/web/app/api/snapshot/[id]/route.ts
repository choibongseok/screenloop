import { SERVER_URL, getSession } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** 브라우저가 서버(Kotlin)에 직접 가지 않도록, 쿠키의 토큰으로 대신 불러 준다. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return Response.json({ error: 'unauthorized', message: '로그인이 필요합니다' }, { status: 401 });
  const { id } = await ctx.params;
  const r = await fetch(`${SERVER_URL}/api/devices/${encodeURIComponent(id)}/snapshot`, { headers: { Authorization: `Bearer ${s.token}` }, cache: 'no-store' });
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
