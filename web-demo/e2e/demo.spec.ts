import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, query = '', firstVisit = false) {
  // 기본은 "이미 본 방문자"(쿠키 있음). 첫 방문 동작을 시험할 때만 firstVisit 를 켠다.
  if (!firstVisit) await page.context().addCookies([{ name: 'sl_tour', value: 'seen', url: 'http://127.0.0.1:4274/screenloop/' }]);
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('./' + query);
  await expect(page.locator('body[data-ready="true"]')).toBeAttached({ timeout: 15_000 });
  // 기기 네 대가 첫 스냅샷을 받아 같은 상태가 될 때까지 기다린 뒤 시작한다
  for (const k of ['web', 'phone', 'tv', 'pc']) await expect(page.getByTestId(`verdict-${k}`)).toHaveText('일치', { timeout: 20_000 });
  return errors;
}
const verdict = (page: Page, k: string) => page.getByTestId(`verdict-${k}`);
const allSame = async (page: Page) => {
  for (const k of ['web', 'phone', 'tv', 'pc']) await expect(verdict(page, k)).toHaveText('일치', { timeout: 20_000 });
};

test('첫 화면: 제목·문단·실행 범위 표시, 기기 네 대가 같은 상태이고 콘솔 오류가 없다', async ({ page }) => {
  const errors = await open(page);
  await expect(page).toHaveTitle('매장 화면 동기화 모의 테스트 — Screenloop');
  await expect(page.locator('#h-hero')).toHaveText('매장 화면 동기화 모의 테스트');
  await expect(page.locator('.lead')).toContainText('매장 TV 에 영상을 편성해 내보내는 서비스를 만들었습니다');
  await expect(page.locator('.lead')).toContainText('재생 기록으로 월 요금을 계산합니다');
  await expect(page.locator('.lead')).not.toContainText('Kotlin');
  await expect(page.locator('#banner')).toContainText('서버 없이 브라우저에서 도는 모의 실행');
  await expect(page.locator('#banner')).toContainText('미리 돌린 결과');
  await allSame(page);
  await expect(page.locator('#verdict-title')).toHaveText('4대 모두 같은 화면을 보고 있습니다');
  expect(errors).toEqual([]);
});

test('운영 웹에서 다음 항목을 누르면 네 대가 같은 항목으로 바뀐다', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('screen-tv').locator('.title')).toHaveText('환영 인사');
  await page.getByTestId('web-next').click();
  for (const k of ['web', 'phone', 'tv', 'pc']) await expect(page.getByTestId(`screen-${k}`).locator('.title')).toHaveText('오늘의 메뉴', { timeout: 10_000 });
  await allSame(page);
  await expect(page.locator('#cmd-log')).toContainText('다음 항목 → 적용됨');
});

test('이벤트 순서 뒤바뀜·중복: 기기가 보관·중복 버림을 하고 끝 상태는 같다', async ({ page }) => {
  await open(page);
  await page.getByTestId('recv-tv').selectOption('reorder');
  await page.getByTestId('recv-pc').selectOption('duplicate');
  await page.getByRole('button', { name: '운영 웹: 연속 조작 6번' }).click();
  await expect(page.locator('#trace-log')).toContainText('앞 번호 기다리는 중', { timeout: 10_000 });
  await expect(page.locator('#trace-log')).toContainText('이미 받아서 버림', { timeout: 10_000 });
  await allSame(page);
  await expect(page.getByTestId('foot-pc')).toContainText(/중복 버림 [1-9]/);
});

test('이벤트 누락: 빠진 구간을 알아채고 스냅샷을 다시 받아 같은 상태로 돌아온다', async ({ page }) => {
  await open(page);
  await page.getByTestId('recv-pc').selectOption('drop');
  await page.getByRole('button', { name: '운영 웹: 연속 조작 6번' }).click();
  await expect(page.locator('#trace-log')).toContainText('빠진 번호가 있어 현재 상태를 다시 받음', { timeout: 10_000 });
  await allSame(page);
});

test('기기 시계가 97초·45초 틀려도 재생 위치 차이가 작다', async ({ page }) => {
  await open(page);
  await page.getByTestId('clock-tv').selectOption('97000');
  await page.getByTestId('clock-pc').selectOption('-45000');
  await expect(page.getByTestId('skew-tv')).toHaveText('시계 +97초');
  await allSame(page);
  const diffs = await page.locator('#result-table tbody tr').evaluateAll((rows) => rows.map((r) => Number(r.children[4]!.textContent)));
  for (const d of diffs) expect(d).toBeLessThan(300);
});

test('두 사람이 동시에 조작하면 한쪽은 거절된다', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: "두 사람이 동시에 '다음'" }).click();
  await expect(page.locator('#cmd-log')).toContainText('적용됨');
  await expect(page.locator('#cmd-log')).toContainText('거절(stale)');
  await page.getByRole('button', { name: '두 사람이 동시에 편성표 저장' }).click();
  await expect(page.locator('#cmd-log')).toContainText('거절(conflict)');
  await allSame(page);
});

test('긴급 공지가 플레이어를 덮고 해제하면 돌아온다', async ({ page }) => {
  await open(page);
  await page.getByTestId('web-notice').click();
  await expect(page.getByTestId('notice-tv')).toHaveText('점심시간 안내: 11:30~13:00');
  await expect(page.getByTestId('notice-pc')).toBeVisible();
  await page.getByTestId('web-notice-clear').click();
  await expect(page.getByTestId('notice-tv')).toBeHidden();
  await allSame(page);
});

test('연결을 끊으면 끊김으로 표시하며 계속 재생하고, 다시 이으면 따라잡는다', async ({ page }) => {
  await open(page);
  await page.getByTestId('cut-tv').click();
  await expect(verdict(page, 'tv')).toHaveText('끊김');
  await page.getByTestId('web-pause').click();
  await expect(verdict(page, 'pc')).toHaveText('일치', { timeout: 10_000 });
  await expect(verdict(page, 'tv')).toHaveText('끊김');
  await expect(page.locator('#verdict-title')).toContainText('연결된 3대는 같은 화면을 보고 있습니다');
  await page.getByTestId('cut-tv').click();
  await expect(verdict(page, 'tv')).toHaveText('일치', { timeout: 20_000 });
  await expect(page.locator('#trace-log')).toContainText('현재 상태를 받아 따라잡음');
});

test('오프라인 재생 뒤 기록 몰아 보내기: 응답이 유실돼도 중복은 걸러지고 기록은 빠짐없이 모인다', async ({ page }) => {
  await open(page);
  await page.locator('#speed').selectOption('4');
  await page.getByTestId('cut-tv').click();
  await expect.poll(async () => Number(await page.getByTestId('rec-tv-1').textContent()), { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
  const queued = Number(await page.getByTestId('rec-tv-1').textContent());
  await page.locator('#lose-reply').click();
  await expect(page.locator('#lose-reply')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('cut-tv').click();
  await expect(page.getByTestId('stat-dups').locator('.v')).not.toHaveText('0', { timeout: 20_000 });
  await expect.poll(async () => Number(await page.getByTestId('rec-tv-1').textContent()), { timeout: 20_000 }).toBeLessThanOrEqual(1);
  expect(Number(await page.getByTestId('rec-tv-5').textContent())).toBeGreaterThanOrEqual(1);
  // 서버가 받은 기록 수 ≥ 끊긴 동안 쌓은 수
  expect(Number(await page.getByTestId('stat-collected').locator('.v').textContent())).toBeGreaterThanOrEqual(queued);
});

test('정산 패널: Kotlin 실행 결과 파일을 읽고, 줄을 누르면 근거(날짜·기록 번호)가 나온다', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('bill-total')).toHaveText('31,480원');
  await page.getByTestId('bill-scn-late-record-adjustment').click();
  await page.getByTestId('bill-step-1').click();
  await expect(page.getByTestId('bill-total')).toHaveText('20,150원');
  await page.getByTestId('bill-line-2').click();
  await expect(page.locator('#bill-trace')).toContainText('d-1 2026-10-20(7,200초, 기록 2번)');
  await expect(page.locator('#bill-trace')).toContainText('d-2 2026-10-25(1,800초, 기록 3번)');
  await expect(page.getByTestId('test-total')).not.toHaveText('0');
  await expect(page.getByTestId('drift-block').first()).toBeVisible();
});

test('첫 방문이면 설명 따라가기가 자동으로 열리고 쿠키를 남기며, 키보드로 넘기고 접었다 다시 열 수 있다', async ({ page }) => {
  await open(page, '', true);
  await expect(page.locator('#tour')).toBeVisible();
  await expect(page.locator('#tour-prog')).toHaveText('1/8');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tour-prog')).toHaveText('2/8');
  await expect(page.locator('.tour-hl').first()).toBeVisible();
  await page.locator('#tour-collapse').click();
  await expect(page.locator('#tour')).toBeHidden();
  await page.locator('#tour-open').click();
  await expect(page.locator('#tour-prog')).toHaveText('2/8');
  for (let i = 0; i < 6; i++) await page.locator('#tour-next').click();
  await expect(page.locator('#tour-prog')).toHaveText('8/8');
  await expect(page.locator('#tour-next')).toHaveText('마치기');
  await page.locator('#tour-next').click();
  await expect(page.locator('#tour')).toBeHidden();
  const c = (await page.context().cookies()).find((x) => x.name === 'sl_tour')!;
  expect(c.value).toBe('seen');
  expect(c.path).toBe('/screenloop/');
  expect(c.sameSite).toBe('Lax');
  expect(c.expires - Date.now() / 1000).toBeGreaterThan(179 * 86400);
});

test('설명 따라가기 3~4장은 고장을 실제로 일으켜 보관·스냅샷 재요청 기록이 나온다', async ({ page }) => {
  await open(page, '', true);
  await page.locator('#tour-next').click();
  await page.locator('#tour-next').click();
  await expect(page.locator('#tour-prog')).toHaveText('3/8');
  await expect(page.locator('#trace-log')).toContainText('보관', { timeout: 10_000 });
  await page.locator('#tour-next').click();
  await expect(page.locator('#trace-log')).toContainText('현재 상태를 다시 받음', { timeout: 10_000 });
  await allSame(page);
});

test('390px 모바일: 가로 스크롤이 없고 설명은 아래 시트로 열린다', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await page.goto('./');
  await expect(page.locator('body[data-ready="true"]')).toBeAttached();
  await expect(page.locator('#tour')).toBeVisible();
  const box = await page.locator('#tour').boundingBox();
  expect(box!.y + box!.height).toBeGreaterThan(780);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await ctx.close();
});
