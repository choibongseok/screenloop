import { expect, test } from '@playwright/test';
import { API, WEB, cid, loginApi, loginWeb } from './support';

test('운영자는 화면 카드 4개를 보고 보기 전용 계정은 조작이 막히며 서버도 같은 이유로 거절한다', async ({ browser, request }) => {
  const op = await loginWeb(browser);
  await expect(op.page.getByTestId('role')).toHaveText('운영자');
  await expect(op.page.locator('[data-testid^="card-"]')).toHaveCount(4);
  await op.page.getByRole('link', { name: '입구 TV' }).click();
  await expect(op.page.getByTestId('device-name')).toHaveText('입구 TV');
  await expect(op.page.getByRole('button', { name: '다음 항목' })).toBeEnabled();

  const viewer = await loginWeb(browser, 'viewer', 'viewer-demo');
  await expect(viewer.page.getByTestId('role')).toHaveText('보기 전용');
  await viewer.page.goto(`${WEB}/devices/d-001`);
  await expect(viewer.page.getByRole('button', { name: '다음 항목' })).toBeDisabled();
  await expect(viewer.page.getByRole('button', { name: '일시정지' })).toBeDisabled();
  await expect(viewer.page.getByRole('button', { name: '편성표 저장' })).toBeDisabled();
  await expect(viewer.page.getByText('보기 전용 계정이라 조작과 편집이 막혀 있습니다')).toBeVisible();
  // 화면이 막은 것만이 아니라 서버가 판정한다: 보기 전용 토큰으로 직접 명령을 보내면 403
  const vt = await loginApi(request, 'viewer', 'viewer-demo');
  const r = await request.post(`${API}/api/devices/d-001/commands`, { headers: { Authorization: `Bearer ${vt}` }, data: { commandId: cid(), type: 'playback.pause' } });
  expect(r.status()).toBe(403);
  await op.context.close(); await viewer.context.close();
});

test('잘못된 비밀번호는 오류를 보이고, 로그인 없이 열면 로그인 화면으로 보낸다', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${WEB}/records`);
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('계정').fill('operator');
  await page.getByLabel('비밀번호').fill('틀린 비밀번호');
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.locator('p.err[role=alert]')).toContainText('계정 정보가 맞지 않습니다');
  await page.getByLabel('비밀번호').fill('');
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.locator('p.err[role=alert]')).toContainText('모두 입력하세요');
  await context.close();
});
