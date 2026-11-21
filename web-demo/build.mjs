// 데모 사이트(정적)를 web-demo/dist 에 만든다. sync-core 와 scenes 는 서버·플레이어·테스트가 쓰는 같은 소스를 esbuild 로 묶는다.
// 모든 URL 이 상대 경로라 GitHub Pages 프로젝트 경로(/screenloop/)에서도, 로컬 어디서든 같게 동작한다.
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname);
const repo = resolve(root, '..');
const dist = resolve(root, 'dist');
if (existsSync(dist)) rmSync(dist, { recursive: true });
mkdirSync(resolve(dist, 'data'), { recursive: true });

const kotlinJs = resolve(repo, 'build/domain-js/screenloop-domain.mjs');
if (!existsSync(kotlinJs)) throw new Error('build/domain-js/screenloop-domain.mjs 가 없음: bash scripts/build-domain-js.sh 를 먼저 실행해야 함');

await build({
  alias: { 'kotlin-domain': kotlinJs },
  entryPoints: [resolve(root, 'src/main.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  outfile: resolve(dist, 'app.js'),
  legalComments: 'none',
  logLevel: 'warning',
});
copyFileSync(resolve(root, 'src/index.html'), resolve(dist, 'index.html'));
copyFileSync(resolve(root, 'src/style.css'), resolve(dist, 'style.css'));
for (const f of ['billing-run.json', 'e2e-billing.json', 'test-results.json', 'spec-drift.json']) {
  const src = resolve(repo, 'docs/evidence', f);
  if (existsSync(src)) copyFileSync(src, resolve(dist, 'data', f));
  else console.warn(`증거 파일 없음(사이트에는 "없음"으로 표시됨): docs/evidence/${f}`);
}
writeFileSync(resolve(dist, '.nojekyll'), '');

const html = readFileSync(resolve(dist, 'index.html'), 'utf8') + readFileSync(resolve(dist, 'app.js'), 'utf8') + readFileSync(resolve(dist, 'style.css'), 'utf8');
if (/(src|href)="\/[^/]/.test(readFileSync(resolve(dist, 'index.html'), 'utf8'))) throw new Error('절대 경로 참조가 있음(Pages 하위 경로에서 깨짐)');
const ext = html.match(/https?:\/\/[^\s"'`)]+/g)?.filter((u) => !/^https?:\/\/(www\.w3\.org|screenloop\.example|json-schema\.org)/.test(u));
if (ext?.length) throw new Error(`외부 URL 참조가 있음: ${[...new Set(ext)].slice(0, 5).join(', ')}`);
console.log(`web-demo/dist 생성: app.js ${(readFileSync(resolve(dist, 'app.js')).length / 1024).toFixed(0)}KB`);
