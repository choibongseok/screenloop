import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, api } from '@/lib/server';
import type { Trace } from '@screenloop/sync-core';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const when = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);

export default async function TracePage({ params }: { params: Promise<{ lineId: string }> }) {
  const { lineId } = await params;
  let t: Trace;
  try {
    t = await api<Trace>(`/api/invoice-lines/${encodeURIComponent(lineId)}/trace`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  return (
    <>
      <div>
        <h1 className="title">정산 줄 근거</h1>
        <p className="sub" data-testid="trace-line">{t.line.description} · {won(t.line.amountWon)} · <Link href="/records">재생 기록·정산으로</Link></p>
      </div>
      <section className="panel" aria-labelledby="h-d">
        <h2 id="h-d">일별 사용량 ({t.daily.length}건)</h2>
        {t.daily.length === 0 ? <p className="empty">이 줄에 연결된 일별 사용량이 없습니다.</p> : (
          <div className="scroll"><table aria-label="일별 사용량">
            <thead><tr><th>화면</th><th>날짜</th><th className="num">정산 초</th><th>원본 기록 번호</th></tr></thead>
            <tbody>{t.daily.map((d) => <tr key={d.id}><td className="mono">{d.deviceId}</td><td className="mono">{d.day}</td><td className="num">{d.billedSeconds.toLocaleString('ko-KR')}</td><td className="mono">{d.recordIds.join(', ')}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>
      <section className="panel" aria-labelledby="h-r">
        <h2 id="h-r">원본 재생 기록 ({t.records.length}건)</h2>
        <div className="scroll"><table aria-label="원본 재생 기록" data-testid="trace-records">
          <thead><tr><th>화면</th><th className="num">일련번호</th><th>항목</th><th>서버 시각 시작</th><th>서버 시각 끝</th><th>수집 시각</th></tr></thead>
          <tbody>{t.records.map((r) => <tr key={r.id}><td className="mono">{r.deviceId}</td><td className="num">{r.seq}</td><td>{r.itemId}</td><td className="mono">{when(r.serverStartedAtMs)}</td><td className="mono">{when(r.serverEndedAtMs)}</td><td className="mono">{when(r.receivedAtMs)}</td></tr>)}</tbody>
        </table></div>
      </section>
    </>
  );
}
