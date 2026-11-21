import { SERVER_URL, getSession } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** 화면 목록(플레이어 연결 상태 포함)을 새로 읽어 준다. 화면 카드가 몇 초마다 부른다. */
export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: 'unauthorized', message: '로그인이 필요합니다' }, { status: 401 });
  const r = await fetch(`${SERVER_URL}/api/devices`, { headers: { Authorization: `Bearer ${s.token}` }, cache: 'no-store' });
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
