import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: '../.test-results/demo.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4274/screenloop/',
    channel: process.env.PW_CHANNEL === undefined ? 'chrome' : process.env.PW_CHANNEL || undefined,
    trace: 'off',
    locale: 'ko-KR',
  },
  webServer: { command: 'node serve.mjs', url: 'http://127.0.0.1:4274/screenloop/', reuseExistingServer: false, timeout: 20_000 },
});
