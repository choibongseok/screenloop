import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { API, SHORT_ITEMS, WEB, cid, loginApi, loginWeb, openPlayer, playRecords, setSchedule } from './support';

test('플레이어가 보낸 재생 기록이 정산 미리보기에 반영되고, 시각이 틀린 기록은 보류로 보인다', async ({ browser, request }) => {
  const tok = await loginApi(request);
  await setSchedule(request, tok, 'd-001', SHORT_ITEMS);
  const lastSeq = (await playRecords(request, tok, 'd-001'))[0]?.seq ?? 0;
  const p = await openPlayer(browser, 'd-001', { flush: 1500, skew: 41_000 });
  const fresh = async () => (await playRecords(request, tok, 'd-001')).filter((r) => r.seq > lastSeq && r.status === 'accepted');
  await expect.poll(async () => (await fresh()).length, { timeout: 40_000 }).toBeGreaterThanOrEqual(3);
  // 기기 시계가 41초 빨라도 서버 시각으로 맞춰 저장된다: 기기 시각과 서버 시각의 차이가 시계 차이와 같다
  for (const r of (await fresh()).slice(0, 3)) expect(Math.abs(r.startedAtMs - r.serverStartedAtMs - 41_000)).toBeLessThan(300);
  await p.context.close();

  // 미래 시각으로 온 기록(오프셋을 못 구한 기기를 흉내 냄)은 수집은 하되 정산에서 뺀다
  const now = Date.now();
  const up = await request.post(`${API}/api/devices/d-002/play-records`, {
    headers: { 'X-Device-Key': 'dk-d-002' },
    data: { clockOffsetMs: 0, records: [{ seq: 9000 + Math.floor(Math.random() * 900), itemId: 'welcome', startedAtMs: now + 3_600_000, endedAtMs: now + 3_660_000 }] },
  });
  expect((await up.json()).quarantined).toBe(1);

  const web = await loginWeb(browser);
  await web.page.goto(`${WEB}/records?device=d-002`);
  await expect(web.page.getByTestId('records-table')).toContainText('보류: 서버 시각보다 미래');
  await web.page.goto(`${WEB}/records?device=d-001`);
  await expect(web.page.getByTestId('records-table').locator('tbody tr').first()).toBeVisible();
  const summary = await web.page.getByTestId('record-summary').textContent();
  expect(Number(/정산 대상 (\d+)건/.exec(summary ?? '')?.[1])).toBeGreaterThanOrEqual(3);
  await expect(web.page.getByTestId('invoice-table')).toContainText(/화면 \d대 기본료/);
  const total = Number((await web.page.getByTestId('invoice-total').textContent())!.replace(/[^\d]/g, ''));
  const month = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7);
  const apiInvoice = await (await request.get(`${API}/api/billing/preview?accountId=acct-1&month=${month}`, { headers: { Authorization: `Bearer ${tok}` } })).json();
  expect(total).toBe(apiInvoice.totalWon); // 화면에 보이는 합계가 서버가 계산한 합계와 같다
  expect(total).toBeGreaterThanOrEqual(9900);
  await web.context.close();
});

test('월 마감: 보기 전용은 못 하고, 운영자는 마감한 뒤 정산 줄에서 원본 재생 기록까지 거슬러 올라가며, 같은 달은 다시 마감되지 않는다', async ({ browser, request }) => {
  const month = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7);
  const viewer = await loginWeb(browser, 'viewer', 'viewer-demo');
  await viewer.page.goto(`${WEB}/records`);
  await expect(viewer.page.getByTestId('close-month')).toBeDisabled();
  const vt = await loginApi(request, 'viewer', 'viewer-demo');
  expect((await request.post(`${API}/api/billing/close`, { headers: { Authorization: `Bearer ${vt}` }, data: { accountId: 'acct-1', month } })).status()).toBe(403);
  await viewer.context.close();

  const op = await loginWeb(browser);
  await op.page.goto(`${WEB}/records`);
  const before = Number((await op.page.getByTestId('invoice-total').textContent())!.replace(/[^\d]/g, ''));
  await op.page.getByTestId('close-month').click();
  await expect(op.page.getByTestId('close-result')).toContainText(`${month} 을 마감했습니다`);
  await expect(op.page.getByTestId('close-result')).toContainText(`합계 ${before.toLocaleString('ko-KR')}원`);
  // 실제 서버가 계산한 정산 줄과 근거를 모아 데모 사이트가 싣는 증거 파일로 남긴다
  const hrefs = await op.page
    .getByTestId('close-result')
    .locator('a')
    .evaluateAll((a) => a.map((x) => x.getAttribute('href') as string));
  const opTok = await loginApi(request);
  const lines = [];
  for (const h of hrefs) {
    const t = await (await request.get(`${API}/api/invoice-lines/${h.split('/').pop()}/trace`, { headers: { Authorization: `Bearer ${opTok}` } })).json();
    lines.push({
      kind: t.line.kind,
      description: t.line.description,
      quantity: t.line.quantity,
      unitWon: t.line.unitWon,
      amountWon: t.line.amountWon,
      dailyRows: t.daily.length,
      sourceRecords: t.records.length,
    });
  }
  writeFileSync(
    resolve(import.meta.dirname, '../../docs/evidence/e2e-billing.json'),
    JSON.stringify({ generatedBy: 'e2e: compose 로 올린 실제 서버·플레이어가 만든 재생 기록으로 월을 마감한 결과', month, totalWon: before, lines }, null, 2) + '\n',
  );
  await op.page.getByTestId('close-result').getByRole('link', { name: '2번 줄' }).click();
  await expect(op.page.getByTestId('trace-line')).toContainText('재생');
  const traceRows = op.page.getByTestId('trace-records').locator('tbody tr');
  expect(await traceRows.count()).toBeGreaterThanOrEqual(3);
  await expect(op.page.getByRole('table', { name: '일별 사용량' })).toContainText('d-001');
  // 같은 달을 다시 마감하면 서버가 409 로 거절하고 화면이 안내한다
  await op.page.goto(`${WEB}/records`);
  await op.page.getByTestId('close-month').click();
  await expect(op.page.getByTestId('close-result')).toContainText('이미 마감했습니다');
  const dup = await request.post(`${API}/api/billing/close`, { headers: { Authorization: `Bearer ${await loginApi(request)}` }, data: { accountId: 'acct-1', month } });
  expect(dup.status()).toBe(409);
  await op.context.close();
  void cid;
});
