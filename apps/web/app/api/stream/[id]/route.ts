import { SERVER_URL, getSession } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** 서버의 이벤트 스트림(SSE)을 그대로 이어 준다. 브라우저가 끊으면 서버로 가는 연결도 같이 끊는다. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return new Response('unauthorized', { status: 401 });
  const { id } = await ctx.params;
  const after = new URL(req.url).searchParams.get('after') ?? '0';
  const lastId = req.headers.get('last-event-id');
  const upstream = await fetch(`${SERVER_URL}/api/devices/${encodeURIComponent(id)}/stream?after=${encodeURIComponent(after)}`, {
    headers: { Authorization: `Bearer ${s.token}`, ...(lastId ? { 'Last-Event-ID': lastId } : {}) },
    signal: req.signal,
    cache: 'no-store',
  });
  if (!upstream.ok || !upstream.body) return new Response('upstream error', { status: 502 });
  return new Response(upstream.body, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
}
