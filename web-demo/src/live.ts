import { $, el, setText, won } from './dom';
import type { LiveInvoice, World } from './sim';

const KIND: Record<string, string> = { screen: '기본료', usage_tier: '재생 구간', adjustment: '조정' };
const NOV = '2026-11';
const DEC = '2026-12';

function fill(table: HTMLElement, inv: LiveInvoice | null, empty: string): void {
  const tbody = $('tbody', table);
  if (!inv || inv.lines.length === 0) {
    const key = `empty:${empty}`;
    if (tbody.dataset.key !== key) {
      tbody.dataset.key = key;
      tbody.replaceChildren(el('tr', {}, el('td', { colspan: 4, text: empty })));
    }
    return;
  }
  const key = JSON.stringify(inv.lines.map((l) => [l.kind, l.quantity, l.amountWon, l.description]));
  if (tbody.dataset.key === key) return;
  tbody.dataset.key = key;
  tbody.replaceChildren(
    ...inv.lines.map((l, i) =>
      el(
        'tr',
        { 'data-testid': `${table.id}-line-${i}`, 'data-kind': l.kind },
        el('td', { text: KIND[l.kind] ?? l.kind }),
        el('td', { text: l.description }),
        el('td', { class: 'num', text: l.quantity.toLocaleString('ko-KR') + (l.kind === 'usage_tier' ? '초' : '') }),
        el('td', { class: 'num', text: won(l.amountWon) }),
      ),
    ),
    el('tr', {}, el('th', { colspan: 3, scope: 'row', text: '합계' }), el('td', { class: 'num', 'data-testid': `${table.id}-total`, text: won(inv.totalWon) })),
  );
}

/** 서버 코드(Kotlin)가 브라우저에서 지금까지 쌓인 기록으로 계산한 정산서를 그린다. 마감한 뒤에 도착한 기록은 12월 정산서의 조정 줄이 된다. */
export function renderLive(world: World): void {
  const s = world.server;
  fill($('#live-nov'), s.invoice(NOV, false), '아직 정산할 재생 기록이 없습니다. TV·PC 가 첫 기록을 보낼 때까지 기다려 주세요.');
  fill($('#live-dec'), s.invoice(DEC, false), '12월에 정산할 것이 없습니다. 11월을 마감한 뒤에 늦게 도착한 기록이 있으면 조정 줄이 생깁니다.');
  const closed = s.isClosed(NOV);
  setText($('#live-nov-state'), closed ? '마감됨' : '마감 전(미리보기)');
  const btn = $('#live-close') as HTMLButtonElement;
  btn.disabled = closed;
  setText($('#live-status'), closed ? '11월을 마감했습니다. 이후에 도착한 기록은 12월 정산서에 조정 줄로 들어갑니다.' : '');
}

export function closeNovember(world: World): void {
  world.server.invoice(NOV, true);
}
