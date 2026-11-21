// docs/TEST_CASES.md 와 실제 테스트 결과를 대조한다.
// 행 수 = 실행된 테스트 수, 모든 행이 실제로 통과한 테스트 하나와 1:1, 종류 열이 파일 위치와 일치, 요약 표의 개수가 맞는지 본다.
// `--list` 를 주면 실제로 실행된 테스트 목록(키)을 종류별로 찍는다(문서를 쓸 때 쓰는 도구).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const problems = [];
const actual = new Map(); // "파일::테스트" -> status
const root = resolve('.');

// vitest json
function vitest(file) {
  if (!existsSync(file)) {
    problems.push(`${file} 가 없음: make verify 로 테스트를 먼저 실행해야 함`);
    return;
  }
  for (const f of JSON.parse(readFileSync(file, 'utf8')).testResults) {
    for (const a of f.assertionResults) actual.set(`${relative(root, f.name)}::${a.fullName}`, a.status);
  }
}
vitest('.test-results/sync-core.json');
vitest('.test-results/web.json');

// JUnit XML(Kotlin): 클래스 이름 -> 소스 파일
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}
const classFile = new Map();
for (const root of ['server/src/test/kotlin', 'domain/src/jvmTest/kotlin', 'domain/src/commonTest/kotlin']) {
  for (const f of walk(root).filter((x) => x.endsWith('.kt'))) for (const m of readFileSync(f, 'utf8').matchAll(/^(?:abstract )?class (\w+)/gm)) classFile.set(m[1], f);
}
function junit(dir) {
  const r = new Map();
  if (!existsSync(dir)) {
    problems.push(`${dir} 가 없음`);
    return r;
  }
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.xml'))) {
    const text = readFileSync(`${dir}/${f}`, 'utf8');
    for (const m of text.matchAll(/<testcase name="([^"]+)" classname="([^"]+)" time="[^"]+"(\/>|>([\s\S]*?)<\/testcase>)/g)) {
      const cls = m[2].split('.').pop();
      const file = classFile.get(cls);
      if (!file) {
        problems.push(`${m[2]}: 소스에서 클래스를 찾지 못함`);
        continue;
      }
      const name = m[1].replace(/\[[^\]]*\]$/, '').replace(/\(\)$/, '');
      r.set(`${file}::${name}`, /<failure|<error/.test(m[4] ?? '') ? 'failed' : /<skipped/.test(m[4] ?? '') ? 'skipped' : 'passed');
    }
  }
  return r;
}
for (const [k, v] of junit('.test-results/kotlin')) actual.set(k, v);
// 도메인 모듈: JVM 시험은 그대로 한 건, 공통(commonTest) 시험은 JVM 과 JS 에서 같은 이름으로 모두 통과해야 한 건으로 센다
const domJvm = junit('.test-results/domain-jvm');
const domJs = junit('.test-results/domain-js');
for (const [k, v] of domJvm) actual.set(k, v);
for (const [k, v] of domJs) {
  if (domJvm.get(k) !== v) problems.push(`공통 시험이 JS 에서 다르게 끝남: ${k} jvm=${domJvm.get(k)} js=${v}`);
}
for (const k of domJvm.keys()) if (k.includes('/commonTest/') && !domJs.has(k)) problems.push(`공통 시험이 JS 에서 실행되지 않음: ${k}`);

// Playwright json
function playwright(file, prefix) {
  if (!existsSync(file)) {
    problems.push(`${file} 가 없음`);
    return;
  }
  const w = (s) => {
    for (const sp of s.specs ?? []) actual.set(`${prefix}${sp.file}::${sp.title}`, sp.ok ? 'passed' : 'failed');
    for (const sub of s.suites ?? []) w(sub);
  };
  for (const s of JSON.parse(readFileSync(file, 'utf8')).suites ?? []) w(s);
}
playwright('.test-results/e2e.json', 'e2e/tests/');
playwright('.test-results/demo.json', 'web-demo/e2e/');

const kindOf = (f) =>
  f.startsWith('server/src/test/') ? (/(IT|MigrationTest)\.kt$/.test(f) ? 'integration' : 'unit') : f.startsWith('e2e/') || f.startsWith('web-demo/e2e/') ? 'e2e' : 'unit';

if (process.argv.includes('--list')) {
  for (const k of [...actual.keys()].sort()) console.log(`${kindOf(k.split('::')[0])}\t${k}`);
  process.exit(0);
}

const doc = readFileSync('docs/TEST_CASES.md', 'utf8');
const rows = doc
  .split('\n')
  .filter((l) => /^\| [A-Z]+-\d{3} \|/.test(l))
  .map((l) => l.split(' | ').map((c) => c.replace(/^\| /, '').replace(/ \|$/, '').trim()));
const perKind = { unit: 0, integration: 0, e2e: 0 };
const ids = new Set();
const mapped = new Set();
for (const cells of rows) {
  if (cells.length !== 7) {
    problems.push(`열 수가 7 이 아님: ${cells[0]}`);
    continue;
  }
  const [id, , , , , ref, kind] = cells;
  if (ids.has(id)) problems.push(`ID 중복: ${id}`);
  ids.add(id);
  const key = ref.replace(/^`|`$/g, '');
  if (!actual.has(key)) problems.push(`${id}: 실제 테스트 없음 -> ${key}`);
  else if (actual.get(key) !== 'passed') problems.push(`${id}: 통과하지 않음(${actual.get(key)}) -> ${key}`);
  if (mapped.has(key)) problems.push(`${id}: 같은 테스트가 두 행에 매핑됨 -> ${key}`);
  mapped.add(key);
  const k = kindOf(key.split('::')[0]);
  if (k !== kind) problems.push(`${id}: 종류가 ${kind} 인데 파일은 ${k}`);
  perKind[k]++;
}
for (const key of actual.keys()) if (!mapped.has(key)) problems.push(`문서에 없는 테스트: ${key}`);
if (rows.length !== actual.size) problems.push(`문서 행 ${rows.length} != 실행된 테스트 ${actual.size}`);
const total = Number(/\*\*합계\*\* \| \*\*(\d+)\*\*/.exec(doc)?.[1]);
if (total !== actual.size) problems.push(`요약 표의 합계 ${total} != 실행된 테스트 ${actual.size}`);
for (const k of ['unit', 'integration', 'e2e']) {
  const m = new RegExp(`\\| ${k} [^|]*\\| (\\d+) \\|`).exec(doc);
  if (!m || Number(m[1]) !== perKind[k]) problems.push(`요약 표의 ${k} 개수 ${m?.[1]} != ${perKind[k]}`);
}
if (problems.length) {
  console.error(`테스트 케이스 문서 대조 실패 (${problems.length}건)`);
  for (const p of problems.slice(0, 40)) console.error(' - ' + p);
  process.exit(1);
}
console.log(`테스트 케이스 문서 대조 통과: 문서 ${rows.length}행 = 실행 ${actual.size}건 (unit ${perKind.unit}, integration ${perKind.integration}, e2e ${perKind.e2e})`);
