import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
  resolve: { alias: { '@': resolve(import.meta.dirname) } },
  test: { include: ['test/**/*.test.ts'], reporters: ['default', ['json', { outputFile: '../../.test-results/web.json' }]] },
});
