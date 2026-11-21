'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { Invoice } from '@screenloop/sync-core';
import { closeMonthAction } from '@/lib/actions';

export function CloseMonthButton({ accountId, month, canOperate }: { accountId: string; month: string; canOperate: boolean }) {
  const [state, setState] = useState<{ tone: 'ok' | 'bad'; text: string; invoice?: Invoice } | null>(null);
  const [busy, setBusy] = useState(false);
  async function close() {
    setBusy(true);
    const r = await closeMonthAction(accountId, month);
    setBusy(false);
    if (r.ok) setState({ tone: 'ok', text: `${month} 을 마감했습니다. 합계 ${r.value.totalWon.toLocaleString('ko-KR')}원`, invoice: r.value });
    else setState({ tone: 'bad', text: r.status === 403 ? '운영자 권한이 필요합니다.' : r.status === 409 ? `${month} 은 이미 마감했습니다.` : r.message });
  }
  return (
    <div>
      <button className="btn danger" type="button" disabled={!canOperate || busy} onClick={close} data-testid="close-month">{month} 마감하기</button>
      {!canOperate && <span className="sub"> 보기 전용 계정은 마감할 수 없습니다.</span>}
      {state && (
        <p className={`toast ${state.tone}`} role="status" data-testid="close-result">
          {state.text}
          {state.invoice && <> · 줄 근거 보기: {state.invoice.lines.map((l, i) => l.id !== null && <span key={i}> <Link href={`/billing/trace/${l.id}`}>{i + 1}번 줄</Link></span>)}</>}
        </p>
      )}
    </div>
  );
}
