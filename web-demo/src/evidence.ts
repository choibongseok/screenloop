import { $, el, setText, won } from './dom';

interface BillLine {
  kind: string;
  description: string;
  quantity: number;
  unitWon: number | null;
  amountWon: number;
  adjustsMonth?: string;
  basisDays: string[];
}
interface BillStep {
  op: string;
  month: string;
  at: string;
  totalWon: number;
  lines: BillLine[];
  usage: { deviceId: string; day: string; billedSeconds: number; recordIds: number[] }[];
}
interface BillScn {
  name: string;
  note: string;
  records: { id: number; deviceId: string; start: string; end: string; receivedAt: string; seconds: number }[];
  steps: BillStep[];
}
interface TestRow {
  kind: string;
  label: string;
  passed: number;
  failed: number;
}
interface Drift {
  title: string;
  change: string;
  where: string;
  command: string;
  exitCode: number;
  excerpt: string;
}

const KIND: Record<string, string> = { screen: '기본료', usage_tier: '재생 구간', adjustment: '조정' };
const SCN_LABEL: Record<string, string> = { 'tier-pricing': '구간 단가', 'overlap-and-midnight': '겹침과 자정', 'late-record-adjustment': '마감 뒤 늦은 기록' };

async function load<T>(name: string): Promise<T | null> {
  try {
    const r = await fetch(`data/${name}`, { cache: 'no-store' });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function initEvidence(): Promise<{ selectBilling(scn: string, step: number): void }> {
  const [billing, e2e, tests, drift] = await Promise.all([
    load<{ scenarios: BillScn[] }>('billing-run.json'),
    load<{
      month: string;
      totalWon: number;
      lines: { kind: string; description: string; quantity: number; amountWon: number; dailyRows: number; sourceRecords: number }[];
      generatedBy: string;
    }>('e2e-billing.json'),
    load<{ rows: TestRow[]; generatedAt: string }>('test-results.json'),
    load<{ blocks: Drift[] }>('spec-drift.json'),
  ]);

  // 정산
  let sel = { scn: 0, step: 0 };
  const picker = $('#bill-picker');
  const renderBilling = () => {
    if (!billing) {
      setText($('#bill-note'), '요금 계산 결과 파일(billing-run.json)을 읽지 못했습니다.');
      return;
    }
    const scn = billing.scenarios[sel.scn]!;
    const step = scn.steps[Math.min(sel.step, scn.steps.length - 1)]!;
    picker.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-checked', String(i === sel.scn)));
    setText($('#bill-note'), scn.note);
    $('#bill-records tbody').replaceChildren(
      ...scn.records.map((r) =>
        el(
          'tr',
          {},
          el('td', { class: 'num', text: String(r.id) }),
          el('td', { text: r.deviceId }),
          el('td', { class: 'mono', text: r.start }),
          el('td', { class: 'mono', text: r.end }),
          el('td', { class: 'mono', text: r.receivedAt }),
        ),
      ),
    );
    const steps = $('#bill-steps');
    steps.replaceChildren(
      ...scn.steps.map((s, i) => {
        const b = el('button', {
          type: 'button',
          role: 'radio',
          'aria-checked': String(i === sel.step),
          text: `${s.month} ${s.op === 'close' ? '마감' : '미리보기'}`,
          'data-testid': `bill-step-${i}`,
        });
        b.addEventListener('click', () => {
          sel.step = i;
          renderBilling();
        });
        return b;
      }),
    );
    setText($('#bill-step-label'), `${step.at} 기준`);
    const tbody = $('#bill-lines tbody');
    const usageIndex = new Map<string, { billedSeconds: number; recordIds: number[] }>();
    for (const s of scn.steps) for (const u of s.usage) usageIndex.set(`${u.deviceId} ${u.day}`, u);
    if (step.lines.length === 0) tbody.replaceChildren(el('tr', {}, el('td', { colspan: 5, text: '계산할 사용량이 없습니다.' })));
    else {
      const rows = step.lines.map((l, i) => {
        const tr = el(
          'tr',
          { class: 'click', tabindex: 0, 'aria-selected': 'false', 'data-testid': `bill-line-${i}` },
          el('td', { text: KIND[l.kind] ?? l.kind }),
          el('td', { text: l.description }),
          el('td', { class: 'num', text: l.quantity.toLocaleString('ko-KR') + (l.kind === 'usage_tier' ? '초' : '') }),
          el('td', { class: 'num', text: l.unitWon === null ? '—' : won(l.unitWon) }),
          el('td', { class: 'num', text: won(l.amountWon) }),
        );
        const pick = () => {
          tbody.querySelectorAll('tr').forEach((r) => r.setAttribute('aria-selected', 'false'));
          tr.setAttribute('aria-selected', 'true');
          const parts = l.basisDays.map((d) => {
            const u = usageIndex.get(d);
            return u ? `${d}(${u.billedSeconds.toLocaleString('ko-KR')}초, 기록 ${u.recordIds.join('·')}번)` : d;
          });
          setText($('#bill-trace'), `이 줄의 근거: ${parts.join(', ') || '없음'}`);
        };
        tr.addEventListener('click', pick);
        tr.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick();
          }
        });
        return tr;
      });
      rows.push(el('tr', {}, el('th', { colspan: 4, scope: 'row', text: '합계' }), el('td', { class: 'num', 'data-testid': 'bill-total', text: won(step.totalWon) })));
      tbody.replaceChildren(...rows);
    }
    setText($('#bill-trace'), '줄을 누르면 그 금액의 근거가 된 날짜와 재생 기록 번호를 보여 줍니다.');
  };
  if (billing) {
    picker.replaceChildren(
      ...billing.scenarios.map((s, i) => {
        const b = el('button', { type: 'button', role: 'radio', 'aria-checked': 'false', text: SCN_LABEL[s.name] ?? s.name, 'data-testid': `bill-scn-${s.name}` });
        b.addEventListener('click', () => {
          sel = { scn: i, step: 0 };
          renderBilling();
        });
        return b;
      }),
    );
  }
  renderBilling();

  // e2e 정산
  if (e2e) {
    setText(
      $('#e2e-bill-note'),
      `실제로 띄운 서버와 플레이어가 만든 재생 기록으로 ${e2e.month} 을 마감한 결과입니다. 합계 ${won(e2e.totalWon)}. 오른쪽 두 칸은 줄마다 연결된 날짜별 사용량과 원본 기록의 수입니다.`,
    );
    $('#e2e-bill tbody').replaceChildren(
      ...e2e.lines.map((l) =>
        el(
          'tr',
          {},
          el('td', { text: KIND[l.kind] ?? l.kind }),
          el('td', { text: l.description }),
          el('td', { class: 'num', text: l.quantity.toLocaleString('ko-KR') }),
          el('td', { class: 'num', text: won(l.amountWon) }),
          el('td', { class: 'num', text: String(l.dailyRows) }),
          el('td', { class: 'num', text: String(l.sourceRecords) }),
        ),
      ),
    );
  } else setText($('#e2e-bill-note'), '자동 시험 결과 파일(e2e-billing.json)이 없습니다. make verify 로 만들어집니다.');

  // 테스트
  if (tests) {
    const tb = $('#test-summary tbody');
    tb.replaceChildren(
      ...tests.rows.map((r) =>
        el(
          'tr',
          {},
          el('td', { text: r.kind }),
          el('td', { text: r.label }),
          el('td', { class: `num ${r.failed === 0 ? 'good' : 'bad'}`, text: String(r.passed) }),
          el('td', { class: `num ${r.failed === 0 ? 'good' : 'bad'}`, text: String(r.failed) }),
        ),
      ),
    );
    const total = tests.rows.reduce((n, r) => n + r.passed, 0);
    tb.append(
      el(
        'tr',
        {},
        el('th', { colspan: 2, text: '합계' }),
        el('td', { class: 'num', 'data-testid': 'test-total', text: String(total) }),
        el('td', { class: 'num', text: String(tests.rows.reduce((n, r) => n + r.failed, 0)) }),
      ),
    );
  } else $('#test-summary tbody').replaceChildren(el('tr', {}, el('td', { colspan: 4, text: '테스트 결과 파일(test-results.json)이 없습니다.' })));

  // 명세 일치
  const d = $('#drift');
  if (drift)
    d.replaceChildren(
      ...drift.blocks.map((b) =>
        el(
          'div',
          { class: 'drift-block', 'data-testid': 'drift-block' },
          el('h4', { text: b.title }),
          el('div', { class: 'meta', text: `바꾼 곳: ${b.where} · ${b.change}` }),
          el('div', { class: 'meta', text: `실행: ${b.command} → 종료 코드 ${b.exitCode}` }),
          el('pre', { text: b.excerpt }),
        ),
      ),
    );
  else d.textContent = '어긋남 시험 결과 파일(spec-drift.json)이 없습니다.';

  return {
    selectBilling(scn: string, step: number) {
      if (!billing) return;
      const i = billing.scenarios.findIndex((s) => s.name === scn);
      if (i >= 0) {
        sel = { scn: i, step };
        renderBilling();
      }
    },
  };
}
