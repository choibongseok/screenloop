import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { API, command, loginApi, snapshot } from './support';

const root = resolve(import.meta.dirname, '../..');
const sh = (script: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync('bash', [resolve(root, 'scripts', script), ...args], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const shFail = (script: string, args: string[], env: Record<string, string>) => {
  try {
    sh(script, args, env);
    return { code: 0, out: '' };
  } catch (e) {
    const x = e as { status: number; stdout: string; stderr: string };
    return { code: x.status, out: `${x.stdout}\n${x.stderr}` };
  }
};
const version = async (request: import('@playwright/test').APIRequestContext) => (await (await request.get(`${API}/api/version`)).json()).version as string;

test('배포와 되돌리기: 새 버전 배포, 직전 버전으로 되돌리기, 잘못된 릴리스는 헬스 체크에서 걸려 자동으로 되돌아가고 데이터는 그대로다', async ({ request }) => {
  test.setTimeout(420_000);
  sh('deploy.sh', ['1.0.0']);
  expect(await version(request)).toBe('1.0.0');
  const tok = await loginApi(request);
  await command(request, tok, 'd-001', { type: 'volume.set', volume: 73 });
  const v1 = (await snapshot(request, tok, 'd-001')).version;

  sh('deploy.sh', ['1.0.1']);
  expect(await version(request)).toBe('1.0.1');
  expect((await snapshot(request, await loginApi(request), 'd-001')).volume).toBe(73); // 배포로 데이터가 사라지지 않는다

  sh('rollback.sh', []);
  expect(await version(request)).toBe('1.0.0');
  const afterRollback = await snapshot(request, await loginApi(request), 'd-001');
  expect(afterRollback.volume).toBe(73);
  expect(afterRollback.version).toBeGreaterThanOrEqual(v1);

  // 잘못된 릴리스: 서버가 DB 에 붙지 못하는 설정으로 배포하면 헬스 체크가 실패하고 스크립트가 직전 버전으로 되돌린다
  const bad = shFail('deploy.sh', ['1.0.2'], { SCREENLOOP_DB_URL: 'jdbc:postgresql://no-such-host:5432/screenloop', DEPLOY_WAIT_SEC: '30' });
  expect(bad.code).toBe(1);
  expect(bad.out).toContain('헬스 체크 실패: 1.0.2');
  expect(bad.out).toContain('되돌리기 완료: 1.0.0');
  expect(await version(request)).toBe('1.0.0');
  expect((await snapshot(request, await loginApi(request), 'd-001')).volume).toBe(73);
});
