import { expect, test, type Page } from '@playwright/test';
import { LONG_ITEMS, WEB, loginApi, loginWeb, openPlayer, setSchedule, snapshot, status } from './support';

const titles = (page: Page) => page.locator('[data-testid^="item-"] input[id^="t-"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

test('편성표 입력 검사: 비운 제목·잘못된 시간이 오류로 보이고 저장되지 않는다', async ({ browser, request }) => {
  const tok = await loginApi(request);
  await setSchedule(request, tok, 'd-003', LONG_ITEMS);
  const before = (await snapshot(request, tok, 'd-003')).scheduleVersion;
  const web = await loginWeb(browser);
  await web.page.goto(`${WEB}/devices/d-003`);
  const first = web.page.getByTestId('item-0');
  await first.getByRole('textbox', { name: '제목', exact: true }).fill('');
  await first.getByRole('textbox', { name: '재생 시간(초)', exact: true }).fill('abc');
  await web.page.getByTestId('save-schedule').click();
  await expect(first).toContainText('제목을 입력하세요.');
  await expect(first).toContainText('재생 시간은 정수(초)로 입력하세요.');
  await expect(first.getByRole('textbox', { name: '제목', exact: true })).toBeFocused();
  await expect(web.page.getByText('입력을 고친 뒤 저장하세요.')).toBeVisible();
  await first.getByRole('textbox', { name: '제목', exact: true }).fill('환영 인사');
  await first.getByRole('textbox', { name: '재생 시간(초)', exact: true }).fill('3601');
  await web.page.getByTestId('save-schedule').click();
  await expect(first).toContainText('1~3600초');
  await first.getByLabel('시간대 편성').check();
  await first.getByLabel('1번 항목 시작 시각').fill('09:00');
  await first.getByLabel('1번 항목 끝 시각').fill('09:00');
  await web.page.getByTestId('save-schedule').click();
  await expect(first).toContainText('시작과 끝이 같으면');
  expect((await snapshot(request, tok, 'd-003')).scheduleVersion).toBe(before);
  await web.context.close();
});

test('편성표 편집: 끌어서·버튼으로 순서를 바꾸고 시간대를 주면 플레이어가 그대로 재생한다', async ({ browser, request }) => {
  const tok = await loginApi(request);
  await setSchedule(request, tok, 'd-003', LONG_ITEMS);
  const web = await loginWeb(browser);
  await web.page.goto(`${WEB}/devices/d-003`);
  await expect.poll(() => titles(web.page)).toEqual(['환영 인사', '오늘의 메뉴', '이벤트 안내']);

  // 끌어서 순서 바꾸기: 3번째를 맨 위로
  await web.page.getByTestId('item-2').dragTo(web.page.getByTestId('item-0'));
  await expect.poll(() => titles(web.page)).toEqual(['이벤트 안내', '환영 인사', '오늘의 메뉴']);
  // 버튼으로: 맨 아래 '오늘의 메뉴'를 한 칸 위로 → [이벤트, 메뉴, 환영]
  await web.page.getByRole('button', { name: /^3번 항목\(오늘의 메뉴\) 위로$/ }).click();
  await expect.poll(() => titles(web.page)).toEqual(['이벤트 안내', '오늘의 메뉴', '환영 인사']);

  // 재생 시간을 4초로 줄이고, '환영 인사'(지금 시각 ±60분)와 '이벤트 안내'(2~3시간 뒤)에 시간대를 준다
  const now = new Date(Date.now() + 9 * 3600_000);
  const m = now.getUTCHours() * 60 + now.getUTCMinutes();
  const hhmm = (x: number) => `${String(Math.floor(((x % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String((((x % 1440) + 1440) % 1440) % 60).padStart(2, '0')}`;
  const rows = await titles(web.page);
  for (let i = 0; i < rows.length; i++) await web.page.getByTestId(`item-${i}`).getByRole('textbox', { name: '재생 시간(초)', exact: true }).fill('4');
  const idx = (t: string) => rows.indexOf(t);
  const welcome = web.page.getByTestId(`item-${idx('환영 인사')}`);
  await welcome.getByLabel('시간대 편성').check();
  await welcome.getByLabel(`${idx('환영 인사') + 1}번 항목 시작 시각`).fill(hhmm(m - 60));
  await welcome.getByLabel(`${idx('환영 인사') + 1}번 항목 끝 시각`).fill(hhmm(m + 60));
  const event = web.page.getByTestId(`item-${idx('이벤트 안내')}`);
  await event.getByLabel('시간대 편성').check();
  await event.getByLabel(`${idx('이벤트 안내') + 1}번 항목 시작 시각`).fill(hhmm(m + 120));
  await event.getByLabel(`${idx('이벤트 안내') + 1}번 항목 끝 시각`).fill(hhmm(m + 180));

  const player = await openPlayer(browser, 'd-003');
  await web.page.getByTestId('save-schedule').click();
  await expect(web.page.getByTestId('toast')).toHaveText('편성표를 저장했습니다.');
  await expect(web.page.getByText('저장된 편성표와 같습니다.')).toBeVisible();
  // 플레이어는 시간대에 맞는 항목(오늘의 메뉴, 환영 인사)만 편성 순서대로 돈다. 이벤트 안내(시간대 밖)는 나오지 않는다.
  const seen: string[] = [];
  for (let i = 0; i < 28; i++) {
    const id = (await status(player.page)).itemId;
    if (id && seen.at(-1) !== id) seen.push(id);
    await player.page.waitForTimeout(500);
  }
  expect(new Set(seen)).toEqual(new Set(['menu', 'welcome']));
  expect(seen).not.toContain('event');
  await Promise.all([web.context.close(), player.context.close()]);
});

test('두 운영자가 동시에 편성표를 고치면 먼저 저장한 쪽이 이기고 늦은 쪽은 안내를 받고 최신본을 불러온다', async ({ browser, request }) => {
  const tok = await loginApi(request);
  await setSchedule(request, tok, 'd-003', LONG_ITEMS);
  const a = await loginWeb(browser);
  const b = await loginWeb(browser);
  await a.page.goto(`${WEB}/devices/d-003`);
  await b.page.goto(`${WEB}/devices/d-003`);
  await expect(b.page.getByTestId('item-0')).toBeVisible();
  await b.page.getByTestId('item-0').getByRole('textbox', { name: '제목', exact: true }).fill('B 가 고친 제목'); // B 는 고치는 중

  await a.page.getByTestId('item-0').getByRole('textbox', { name: '제목', exact: true }).fill('A 가 먼저 저장');
  await a.page.getByTestId('save-schedule').click();
  await expect(a.page.getByTestId('toast')).toHaveText('편성표를 저장했습니다.');

  await expect(b.page.getByText('편집하는 사이 다른 사람이 편성표를 저장했습니다')).toBeVisible();
  await b.page.getByTestId('save-schedule').click();
  await expect(b.page.getByTestId('toast')).toContainText('다른 사람이 먼저 편성표를 저장했습니다');
  expect((await snapshot(request, tok, 'd-003')).schedule.items[0]!.title).toBe('A 가 먼저 저장');
  await b.page.getByRole('button', { name: '최신 편성표 불러오기' }).click();
  await expect.poll(() => titles(b.page).then((t) => t[0])).toBe('A 가 먼저 저장');
  await Promise.all([a.context.close(), b.context.close()]);
});
