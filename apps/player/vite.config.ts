import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { SCENE_IDS, sceneSvg } from '@screenloop/scenes';

/** 장면 SVG 를 /scenes/<id>.svg 로 내보낸다. 플레이어가 이 파일을 미리 내려받아 캐시에 둔다. */
function scenes(): Plugin {
  return {
    name: 'screenloop-scenes',
    configureServer(server) {
      server.middlewares.use('/scenes/', (req, res, next) => {
        const id = (req.url ?? '').replace(/^\//, '').replace(/\.svg.*$/, '');
        if (!(SCENE_IDS as string[]).includes(id)) return next();
        res.setHeader('Content-Type', 'image/svg+xml');
        res.end(sceneSvg(id));
      });
    },
    generateBundle() {
      for (const id of SCENE_IDS) this.emitFile({ type: 'asset', fileName: `scenes/${id}.svg`, source: sceneSvg(id) });
    },
  };
}

export default defineConfig({
  plugins: [react(), scenes()],
  server: { proxy: { '/api': { target: process.env.SERVER_URL ?? 'http://127.0.0.1:59680', changeOrigin: true } } },
  build: { outDir: 'dist', sourcemap: false },
});
