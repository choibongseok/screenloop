import Link from 'next/link';
import { api, requireSession } from '@/lib/server';
import type { DeviceSummary, Invoice, PlayRecordRow } from '@screenloop/sync-core';
import { CloseMonthButton } from '@/components/CloseMonthButton';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const kstMonth = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7);
const when = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().replace('T', ' ').slice(5, 19);
const reasonText: Record<string, string> = { non_positive: '끝 시각이 시작보다 빠르거나 같음', too_long: '6시간 초과', in_future: '서버 시각보다 미래' };
const kindText: Record<string, string> = { screen: '기본료', usage_tier: '재생 구간', adjustment: '조정' };

export default async function RecordsPage({ searchParams }: { searchParams: Promise<{ month?: string; device?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? '') ? sp.month! : kstMonth();
  const devices = await api<DeviceSummary[]>('/api/devices');
  const deviceId = devices.some((d) => d.id === sp.device) ? sp.device! : devices[0]?.id;
  const [records, invoice] = await Promise.all([
    deviceId ? api<PlayRecordRow[]>(`/api/devices/${deviceId}/play-records`) : Promise.resolve([] as PlayRecordRow[]),
    api<Invoice>(`/api/billing/preview?accountId=acct-1&month=${month}`),
  ]);
  const accepted = records.filter((r) => r.status === 'accepted').length;
  return (
    <>
      <div>
        <h1 className="title">재생 기록·정산</h1>
        <p className="sub">플레이어가 보낸 재생 기록과, 그 기록으로 계산한 월 정산서입니다. 시각은 한국 시간입니다.</p>
      </div>

      <section className="panel" aria-labelledby="h-rec">
        <h2 id="h-rec">재생 기록</h2>
        <form className="row" method="get">
          <input type="hidden" name="month" value={month} />
          <label htmlFor="dev">화면</label>
          <select id="dev" name="device" defaultValue={deviceId}>{devices.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.id})</option>)}</select>
          <button className="btn small" type="submit">보기</button>
          <span className="sub" data-testid="record-summary">최근 {records.length}건 중 정산 대상 {accepted}건, 보류 {records.length - accepted}건</span>
        </form>
        {records.length === 0 ? <p className="empty">아직 수집된 재생 기록이 없습니다.</p> : (
          <div className="scroll" style={{ marginTop: 8, maxHeight: 360, overflow: 'auto' }}>
            <table aria-label="재생 기록 목록" data-testid="records-table">
              <thead><tr><th className="num">일련번호</th><th>항목</th><th>서버 시각 시작</th><th className="num">길이(초)</th><th>상태</th></tr></thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    <td className="num">{r.seq}</td><td>{r.itemId}</td><td className="mono">{when(r.serverStartedAtMs)}</td>
                    <td className="num">{Math.round((r.endedAtMs - r.startedAtMs) / 1000)}</td>
                    <td>{r.status === 'accepted' ? <span className="badge ok">정산 대상</span> : <span className="badge warn">보류: {reasonText[r.reason ?? ''] ?? r.reason}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="h-inv">
        <h2 id="h-inv">정산서 미리보기</h2>
        <form className="row" method="get">
          {deviceId && <input type="hidden" name="device" value={deviceId} />}
          <label htmlFor="month">월</label>
          <input id="month" name="month" type="text" defaultValue={month} pattern="\d{4}-\d{2}" style={{ width: 90 }} aria-describedby="month-help" />
          <button className="btn small" type="submit">계산</button>
          <span id="month-help" className="sub">YYYY-MM 형식. 저장하지 않는 미리보기입니다.</span>
        </form>
        {invoice.lines.length === 0 ? <p className="empty" data-testid="invoice-empty">{month} 에 정산할 재생 기록이 없습니다.</p> : (
          <div className="scroll" style={{ marginTop: 8 }}>
            <table aria-label={`${month} 정산서`} data-testid="invoice-table">
              <thead><tr><th>구분</th><th>내용</th><th className="num">수량</th><th className="num">단가</th><th className="num">금액</th></tr></thead>
              <tbody>
                {invoice.lines.map((l, i) => (
                  <tr key={i}><td>{kindText[l.kind]}</td><td>{l.description}</td><td className="num">{l.quantity.toLocaleString('ko-KR')}{l.kind === 'usage_tier' ? '초' : ''}</td><td className="num">{l.unitWon === null ? '—' : won(l.unitWon)}</td><td className="num">{won(l.amountWon)}</td></tr>
                ))}
                <tr><th colSpan={4} style={{ textAlign: 'right' }}>합계</th><td className="num" data-testid="invoice-total"><strong>{won(invoice.totalWon)}</strong></td></tr>
              </tbody>
            </table>
          </div>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <CloseMonthButton accountId="acct-1" month={month} canOperate={s.role === 'operator'} />
        </div>
      </section>
      <p className="sub">마감한 정산서는 <Link href="/billing/trace/0">줄마다 근거 기록</Link>을 거슬러 올라가 볼 수 있습니다(마감 뒤 정산 줄의 번호로 열립니다).</p>
    </>
  );
}
