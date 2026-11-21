import { defineConfig } from '@playwright/test';

// compose 전체 구성(서버·웹·플레이어·PostgreSQL·Redis)이 떠 있어야 한다. make e2e 가 올리고 내린다.
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['json', { outputFile: '../.test-results/e2e.json' }]],
  use: { channel: process.env.PW_CHANNEL === undefined ? 'chrome' : process.env.PW_CHANNEL || undefined, trace: 'off', locale: 'ko-KR' },
});
