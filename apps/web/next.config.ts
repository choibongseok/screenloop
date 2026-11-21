import type { NextConfig } from 'next';
import { resolve } from 'node:path';

const config: NextConfig = {
  output: 'standalone',
  // 모노레포 루트까지 추적해야 standalone 에 sync-core 가 들어간다
  outputFileTracingRoot: resolve(import.meta.dirname, '../..'),
  transpilePackages: ['@screenloop/sync-core', '@screenloop/scenes'],
  poweredByHeader: false,
  reactStrictMode: true,
};
export default config;
