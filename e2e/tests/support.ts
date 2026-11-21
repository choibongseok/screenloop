import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:59681';
export const PLAYER = process.env.PLAYER_URL ?? 'http://127.0.0.1:59682';
export const API = process.env.API_URL ?? 'http://127.0.0.1:59680';

export interface PlayerStatus {
  deviceId: string; connection: string; version: number | null; itemId: string | null; itemTitle: string | null;
  offsetInItemMs: number | null; itemDurationMs: number | null; paused: boolean | null; volume: number | null; override: string | null;
  queued: number; lastAckSeq: number; sent: number; flushFailures: number; duplicatesReported: number; clockOffsetMs: number;
  snapshots: number; reconnects: number; scenesCached: string[];
}

export async function loginApi(request: APIRequestContext, user = 'operator', password = 'operator-demo'): Promise<string> {
  const r = await request.post(`${API}/api/auth/login`, { data: { username: user, password } });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).token as string;
}

let seq = 0;
export const cid = () => `e2e-${Date.now().toString(36)}-${++seq}`;

export async function command(request: APIRequestContext, token: string, deviceId: string, cmd: Record<string, unknown>) {
  const r = await request.post(`${API}/api/devices/${deviceId}/commands`, { headers: { Authorization: `Bearer ${token}` }, data: { commandId: cid(), ...cmd } });
  expect(r.ok()).toBeTruthy();
  return r.json() as Promise<{ result: string; reason?: string; version: number }>;
}

export async function snapshot(request: APIRequestContext, token: string, deviceId: string) {
  const r = await request.get(`${API}/api/devices/${deviceId}/snapshot`, { headers: { Authorization: `Bearer ${token}` } });
  return (await r.json()).state as { version: number; scheduleVersion: number; volume: number; playback: { paused: boolean }; schedule: { items: { id: string; title: string }[] } };
}

/** 같은 편성표를 화면에 넣는다(현재 버전을 읽어 그 위에 교체) */
export async function setSchedule(request: APIRequestContext, token: string, deviceId: string, items: object[]) {
  const s = await snapshot(request, token, deviceId);
  const r = await command(request, token, deviceId, { type: 'schedule.replace', baseScheduleVersion: s.scheduleVersion, items });
  expect(r.result).toBe('accepted');
}

export const status = (page: Page): Promise<PlayerStatus> => page.evaluate(() => (window as unknown as { __player?: () => unknown }).__player?.() as never);

export async function openPlayer(browser: Browser, deviceId: string, opts: { skew?: number; flush?: number; base?: string } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  // 실제 기기는 일련번호를 저장소에 남겨 두고 이어서 쓴다. 시험에서는 새 브라우저 컨텍스트를 쓰므로 서버가 아는 마지막 번호 다음부터 시작하게 심어 둔다.
  const op = await loginApi(context.request);
  const rows = (await (await context.request.get(`${API}/api/devices/${deviceId}/play-records`, { headers: { Authorization: `Bearer ${op}` } })).json()) as { seq: number }[];
  const nextSeq = (rows[0]?.seq ?? 0) + 1;
  await context.addInitScript(({ key, seq }) => { try { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ rows: [], nextSeq: seq })); } catch { /* 무시 */ } }, { key: `sl_queue_${deviceId}`, seq: nextSeq });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|EventSource/i.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  (page as unknown as { __errors: string[] }).__errors = errors;
  const q = new URLSearchParams({ device: deviceId, flush: String(opts.flush ?? 2000), debug: '1' });
  if (opts.skew) q.set('skew', String(opts.skew));
  await page.goto(`${opts.base ?? PLAYER}/?${q}`);
  await expect.poll(async () => (await status(page))?.connection, { timeout: 15_000 }).toBe('online');
  return { context, page };
}

export async function loginWeb(browser: Browser, user = 'operator', password = 'operator-demo'): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${WEB}/login`);
  await page.getByLabel('계정').fill(user);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByTestId('who')).toHaveText(user);
  return { context, page };
}

export const LONG_ITEMS = [
  { id: 'welcome', title: '환영 인사', sceneId: 'aurora', durationSec: 120 },
  { id: 'menu', title: '오늘의 메뉴', sceneId: 'waves', durationSec: 120 },
  { id: 'event', title: '이벤트 안내', sceneId: 'grid', durationSec: 120 },
];

export const SHORT_ITEMS = [
  { id: 'welcome', title: '환영 인사', sceneId: 'aurora', durationSec: 4 },
  { id: 'menu', title: '오늘의 메뉴', sceneId: 'waves', durationSec: 4 },
  { id: 'event', title: '이벤트 안내', sceneId: 'grid', durationSec: 4 },
];

export async function playRecords(request: APIRequestContext, token: string, deviceId: string) {
  const r = await request.get(`${API}/api/devices/${deviceId}/play-records`, { headers: { Authorization: `Bearer ${token}` } });
  return (await r.json()) as { seq: number; status: string; startedAtMs: number; endedAtMs: number; serverStartedAtMs: number; serverEndedAtMs: number; itemId: string }[];
}
