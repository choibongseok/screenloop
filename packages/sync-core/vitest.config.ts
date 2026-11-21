import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'], reporters: ['default', ['json', { outputFile: '../../.test-results/sync-core.json' }]] } });
