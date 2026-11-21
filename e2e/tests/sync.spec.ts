import { expect, test } from '@playwright/test';
import { LONG_ITEMS, SHORT_ITEMS, WEB, loginApi, loginWeb, openPlayer, setSchedule, status, snapshot, command } from './support';

test('운영 웹의 다음·일시정지·재개가 같은 편성표를 보는 플레이어에 반영되고 화면 두 개가 같은 상태를 보인다', async ({ browser, request }) => {
  const tok = await loginApi(request);
  await setSchedule(request, tok, 'd-001', LONG_ITEMS);
  await setSchedule(request, tok, 'd-002', LONG_ITEMS);
  const web = await loginWeb(browser);
  const p1 = await openPlayer(browser, 'd-001');
  const p2 = await openPlayer(browser, 'd-002', { skew: 97_000 });
  await expect.poll(async () => (await status(p1.page)).itemId).toBe('welcome');

  // 운영 웹에서 d-001 '다음 항목'
  await web.page.goto(`${WEB}/devices/d-001`);
  await expect(web.page.getByTestId('now-title')).toHaveText('환영 인사');
  await web.page.getByRole('button', { name: '다음 항목' }).click();
  await expect(web.page.getByTestId('toast')).toHaveText('다음 항목으로 넘겼습니다.');
  await expect.poll(async () => (await status(p1.page)).itemId).toBe('menu');
  await expect(web.page.getByTestId('now-title')).toHaveText('오늘의 메뉴');
  expect((await status(p2.page)).itemId).toBe('welcome'); // d-002 는 다른 화면이라 그대로

  // 묶음(1층: d-001, d-002) 일시정지·재개: 두 플레이어가 함께 멈추고 함께 움직인다
  await web.page.goto(`${WEB}/groups`);
  const g1 = web.page.getByTestId('group-g-1');
  await g1.getByRole('button', { name: '전체 일시정지' }).click();
  await expect(g1.getByTestId('group-row-d-001')).toContainText('적용됨');
  await expect(g1.getByTestId('group-row-d-002')).toContainText('적용됨');
  await expect.poll(async () => [(await status(p1.page)).paused, (await status(p2.page)).paused]).toEqual([true, true]);
  await g1.getByRole('button', { name: '전체 일시정지' }).click();
  await expect(g1.getByTestId('group-row-d-001')).toContainText('이미 그 상태');
  await g1.getByRole('button', { name: '전체 재개' }).click();
  await expect.poll(async () => [(await status(p1.page)).paused, (await status(p2.page)).paused]).toEqual([false, false]);
  await g1.getByRole('button', { name: '음량 60' }).click();
  await expect.poll(async () => [(await status(p1.page)).volume, (await status(p2.page)).volume]).toEqual([60, 60]);
  await Promise.all([web.context.close(), p1.context.close(), p2.context.close()]);
});

test('기기 시계가 97초 어긋난 플레이어 두 대가 같은 순간 같은 항목을 보인다 (서버 시각 기준 보정)', async ({ browser, request }) => {
  const tok = await loginApi(request);
  await setSchedule(request, tok, 'd-001', SHORT_ITEMS);
  await setSchedule(request, tok, 'd-002', SHORT_ITEMS);
  const a = await openPlayer(browser, 'd-001');
  const b = await openPlayer(browser, 'd-002', { skew: 97_000 }); // 12초 한 바퀴에서 97초 = 1초 어긋남(보정이 없으면 항목이 달라진다)
  await expect.poll(async () => Math.abs((await status(b.page)).clockOffsetMs + 97_000)).toBeLessThan(100);
  let compared = 0, mismatches = 0;
  for (let i = 0; i < 30; i++) {
    const [sa, sb] = await Promise.all([status(a.page), status(b.page)]);
    compared++;
    if (sa.itemId !== sb.itemId) {
      // 항목 경계 바로 앞뒤(0.8초 안)에서만 다를 수 있다
      const nearBoundary = (s: typeof sa) => (s.offsetInItemMs ?? 9999) < 800 || (s.itemDurationMs ?? 0) - (s.offsetInItemMs ?? 0) < 800;
      if (!(nearBoundary(sa) || nearBoundary(sb))) mismatches++;
    }
    await a.page.waitForTimeout(400);
  }
  expect(compared).toBe(30);
  expect(mismatches).toBe(0);
  expect(Math.abs((await status(b.page)).clockOffsetMs + 97_000)).toBeLessThan(100);
  await Promise.all([a.context.close(), b.context.close()]);
});

test('긴급 공지가 플레이어 두 대를 덮고 해제하면 원래 화면으로 돌아온다', async ({ browser, request }) => {
  const tok = await loginApi(request);
  await setSchedule(request, tok, 'd-001', LONG_ITEMS);
  await setSchedule(request, tok, 'd-002', LONG_ITEMS);
  const web = await loginWeb(browser);
  const p1 = await openPlayer(browser, 'd-001');
  const p2 = await openPlayer(browser, 'd-002');
  await web.page.goto(`${WEB}/devices/d-001`);
  await web.page.getByLabel('공지 문구').fill('점심시간 11:30~13:00 안내');
  await web.page.getByRole('button', { name: '공지 표시' }).click();
  await expect(p1.page.getByTestId('override')).toHaveText('점심시간 11:30~13:00 안내');
  await expect(web.page.getByTestId('override-banner')).toHaveText('점심시간 11:30~13:00 안내');
  await expect(p2.page.getByTestId('override')).toHaveCount(0); // d-002 는 따로
  // 묶음에서 1층 전체에 공지
  await web.page.goto(`${WEB}/groups`);
  const g1 = web.page.getByTestId('group-g-1');
  await g1.getByLabel('1층 긴급 공지 문구').fill('화재 대피 훈련 중입니다');
  await g1.getByRole('button', { name: '공지 표시' }).click();
  await expect(p2.page.getByTestId('override')).toHaveText('화재 대피 훈련 중입니다');
  await expect(p1.page.getByTestId('override')).toHaveText('화재 대피 훈련 중입니다'); // 나중에 도착한 공지가 이긴다
  await g1.getByRole('button', { name: '공지 해제' }).click();
  await expect(p1.page.getByTestId('override')).toHaveCount(0);
  await expect(p2.page.getByTestId('override')).toHaveCount(0);
  await Promise.all([web.context.close(), p1.context.close(), p2.context.close()]);
});

test('휴대폰 리모컨(390px)이 운영 콘솔·플레이어와 같은 상태를 보고 같은 명령을 보낸다', async ({ browser, request }) => {
  const tok = await loginApi(request);
  await setSchedule(request, tok, 'd-001', LONG_ITEMS);
  const player = await openPlayer(browser, 'd-001');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true });
  const phone = await ctx.newPage();
  await phone.goto(`${WEB}/login`);
  await phone.getByLabel('계정').fill('operator');
  await phone.getByLabel('비밀번호').fill('operator-demo');
  await phone.getByRole('button', { name: '로그인' }).click();
  await expect(phone.getByTestId('who')).toBeVisible();
  await phone.goto(`${WEB}/remote/d-001`);
  await expect(phone.getByTestId('remote-now')).toHaveText('환영 인사');
  expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await phone.getByRole('button', { name: '다음', exact: true }).click();
  await expect(phone.getByTestId('remote-now')).toHaveText('오늘의 메뉴');
  await expect.poll(async () => (await status(player.page)).itemId).toBe('menu');
  await phone.getByRole('button', { name: '음량 +' }).click();
  await expect.poll(async () => (await status(player.page)).volume).toBe(((await snapshot(request, tok, 'd-001')).volume));
  await phone.getByRole('button', { name: '일시정지' }).click();
  await expect.poll(async () => (await status(player.page)).paused).toBe(true);
  await expect(phone.getByRole('button', { name: '재개' })).toBeVisible();
  await command(request, tok, 'd-001', { type: 'playback.resume' });
  await expect(phone.getByRole('button', { name: '일시정지' })).toBeVisible(); // 다른 곳에서 한 조작이 리모컨에도 반영
  await Promise.all([ctx.close(), player.context.close()]);
});
