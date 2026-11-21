import { expect, test } from '@playwright/test';
import { CuttableProxy } from './netproxy';
import { PLAYER, SHORT_ITEMS, command, loginApi, openPlayer, playRecords, setSchedule, status } from './support';

test('네트워크가 끊겨도 마지막 편성으로 계속 재생하고, 다시 붙으면 놓친 조작을 따라잡고 쌓은 재생 기록을 보낸다', async ({ browser, request }) => {
  const tok = await loginApi(request);
  await setSchedule(request, tok, 'd-004', SHORT_ITEMS);
  await command(request, tok, 'd-004', { type: 'playback.resume' }); // 이전 시험이 멈춰 뒀을 수 있음
  const proxy = await CuttableProxy.start(PLAYER);
  const p = await openPlayer(browser, 'd-004', { base: proxy.url, flush: 2000 });
  await expect.poll(async () => (await status(p.page)).sent, { timeout: 20_000 }).toBeGreaterThan(0); // 정상일 때는 기록이 바로 나간다
  const recordsBefore = (await playRecords(request, tok, 'd-004')).length;
  const stBefore = await status(p.page);

  proxy.cut(); // 와이파이가 나간 상태
  await expect.poll(async () => (await status(p.page)).connection, { timeout: 15_000 }).toBe('offline');
  await expect(p.page.getByTestId('offline-badge')).toBeVisible();
  // 끊긴 동안에도 마지막 편성으로 계속 돈다(4초짜리 항목이 바뀐다)
  const seen = new Set<string>();
  for (let i = 0; i < 26; i++) {
    const id = (await status(p.page)).itemId;
    if (id) seen.add(id);
    await p.page.waitForTimeout(500);
  }
  expect(seen.size).toBeGreaterThanOrEqual(3);
  const offlineSt = await status(p.page);
  expect(offlineSt.queued).toBeGreaterThanOrEqual(2); // 못 보낸 재생 기록이 기기 안에 쌓인다
  expect(offlineSt.flushFailures).toBeGreaterThanOrEqual(1);

  // 끊긴 사이에 운영자가 한 조작(일시정지, 긴급 공지)
  await command(request, tok, 'd-004', { type: 'playback.pause' });
  await command(request, tok, 'd-004', { type: 'override.set', text: '끊긴 사이 띄운 공지', durationSec: 120 });
  expect((await status(p.page)).paused).toBe(false); // 플레이어는 아직 모른다

  proxy.restore();
  await expect.poll(async () => (await status(p.page)).connection, { timeout: 30_000 }).toBe('online');
  await expect.poll(async () => (await status(p.page)).paused, { timeout: 10_000 }).toBe(true); // 따라잡기
  await expect(p.page.getByTestId('override')).toHaveText('끊긴 사이 띄운 공지');
  const after = await status(p.page);
  expect(after.reconnects).toBeGreaterThanOrEqual(stBefore.reconnects + 1);
  expect(after.snapshots).toBeGreaterThanOrEqual(stBefore.snapshots + 1);

  // 쌓아 둔 재생 기록이 모두 서버에 도착하고 대기열이 비며, 일련번호에 빈틈도 중복도 없다
  await expect.poll(async () => (await status(p.page)).queued, { timeout: 15_000 }).toBeLessThanOrEqual(1);
  const rows = await playRecords(request, tok, 'd-004');
  expect(rows.length).toBeGreaterThanOrEqual(recordsBefore + 2);
  const seqs = rows.map((r) => r.seq).sort((x, y) => x - y);
  expect(new Set(seqs).size).toBe(seqs.length);
  for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBe(seqs[i - 1]! + 1);
  expect(rows.every((r) => r.status === 'accepted')).toBe(true);

  await command(request, tok, 'd-004', { type: 'override.clear' });
  await command(request, tok, 'd-004', { type: 'playback.resume' });
  await p.context.close();
  await proxy.stop();
});
