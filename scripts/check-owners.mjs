// CODEOWNERS 검사: (1) 최상위 모듈 경로가 모두 담당자 줄에 걸리고, (2) 줄마다 서로 다른 담당자가 2명 이상이며,
// (3) `# feature:` 로 적은 기능마다 그 경로들의 담당자 합집합이 2명 이상인지 본다(한 사람이 빠져도 대응할 사람이 남는다).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';

const text = readFileSync('CODEOWNERS', 'utf8').split('\n');
const rules = text
  .filter((l) => /^\//.test(l))
  .map((l) => {
    const [path, ...owners] = l.trim().split(/\s+/);
    return { path: path.replace(/^\//, '').replace(/\/$/, ''), owners };
  });
const features = text
  .map((l) => /^# feature: (.+?) = (.+)$/.exec(l))
  .filter(Boolean)
  .map((m) => ({ name: m[1], paths: m[2].trim().split(/\s+/) }));
const problems = [];

for (const r of rules) {
  if (new Set(r.owners).size < 2) problems.push(`/${r.path}: 담당자가 2명 미만 (${r.owners.join(', ') || '없음'})`);
  if (!existsSync(r.path)) problems.push(`/${r.path}: 존재하지 않는 경로`);
}
const covers = (p) => rules.find((r) => p === r.path || p.startsWith(r.path + '/'));
const modules = [];
for (const top of ['packages', 'apps'])
  for (const d of readdirSync(top)) if (statSync(`${top}/${d}`).isDirectory() && existsSync(`${top}/${d}/package.json`)) modules.push(`${top}/${d}`);
modules.push('server', 'spec', 'db', 'scripts', 'e2e', 'web-demo');
for (const m of modules) if (!covers(m)) problems.push(`${m}: 담당자 줄이 없음`);

for (const f of features) {
  const owners = new Set();
  for (const p of f.paths) {
    const r = covers(p);
    if (!r) problems.push(`기능 "${f.name}": ${p} 는 담당자 줄이 없음`);
    else r.owners.forEach((o) => owners.add(o));
  }
  if (owners.size < 2) problems.push(`기능 "${f.name}": 대응 가능한 사람이 2명 미만 (${[...owners].join(', ')})`);
}
if (features.length === 0) problems.push('기능 목록(# feature:)이 없음');

if (problems.length) {
  console.error('CODEOWNERS 검사 실패:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log(`CODEOWNERS 통과: 모듈 ${modules.length}개 경로 모두 담당 2명 이상, 기능 ${features.length}개 모두 대응 가능한 사람 2명 이상`);
