// 명세와 코드가 어긋나면 make verify 가 막는지 실제로 깨뜨려 본다. 파일을 잠깐 고쳐서 검사를 돌리고, 끝나면(실패해도) 원래대로 돌려놓는다.
// 출력: docs/evidence/spec-drift.json (데모 사이트가 싣는다), docs/SPEC_DRIFT.md 는 사람이 쓴 설명이다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SPEC = 'spec/openapi.yaml';
const API = 'server/src/main/kotlin/screenloop/api/Api.kt';
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 50_000_000 });
  return { code: r.status ?? 1, out: `${r.stdout}\n${r.stderr}` };
};
const pick = (out, re, n = 6) =>
  out
    .split('\n')
    .filter((l) => re.test(l))
    .map((l) => l.trim().replace(/\s+/g, ' ').slice(0, 230))
    .slice(0, n)
    .join('\n');
const blocks = [];
const backups = { [SPEC]: readFileSync(SPEC, 'utf8'), [API]: readFileSync(API, 'utf8') };
const restore = () => {
  for (const [f, c] of Object.entries(backups)) writeFileSync(f, c);
};
process.on('exit', restore);

try {
  // 1) 명세만 바꾼다: Snapshot 의 serverTimeMs 를 serverClockMs 로
  writeFileSync(SPEC, backups[SPEC].replaceAll('serverTimeMs', 'serverClockMs'));
  const a = run('node', ['scripts/spec-export.mjs', '--check']);
  blocks.push({
    title: '명세만 바꾸면: 생성물 검사가 막는다',
    change: 'Snapshot 의 serverTimeMs 를 serverClockMs 로 바꿈(코드는 그대로)',
    where: SPEC,
    command: 'node scripts/spec-export.mjs --check',
    exitCode: a.code,
    excerpt: pick(a.out, /어긋|다름|npm run/),
  });
  const b = run('bash', ['scripts/gradle.sh', ':server:test', '--tests', '*ContractIT', '--console=plain']);
  blocks.push({
    title: '명세만 바꾸면: 계약 테스트도 막는다',
    change: '같은 변경. 서버는 여전히 serverTimeMs 를 응답한다',
    where: SPEC,
    command: 'gradlew :server:test --tests *ContractIT',
    exitCode: b.code,
    excerpt: pick(b.out, /명세\(|serverClockMs|required property|FAILED/),
  });
  writeFileSync(SPEC, backups[SPEC]);

  // 2) 코드만 바꾼다: 서버 응답의 필드 이름
  writeFileSync(
    API,
    backups[API].replace('data class SnapshotDto(val state: DeviceState, val serverTimeMs: Long)', 'data class SnapshotDto(val state: DeviceState, val serverClock: Long)').replace(
      'SnapshotDto(s, clock.millis())',
      'SnapshotDto(s, clock.millis())',
    ),
  );
  const c = run('bash', ['scripts/gradle.sh', ':server:test', '--tests', '*ContractIT', '--console=plain']);
  blocks.push({
    title: '코드만 바꾸면: 계약 테스트가 막는다',
    change: '서버 응답의 serverTimeMs 를 serverClock 으로 바꿈(명세는 그대로)',
    where: API,
    command: 'gradlew :server:test --tests *ContractIT',
    exitCode: c.code,
    excerpt: pick(c.out, /명세\(|serverClock|required property|additional|FAILED/),
  });
} finally {
  restore();
}
mkdirSync('docs/evidence', { recursive: true });
writeFileSync('docs/evidence/spec-drift.json', JSON.stringify({ blocks }, null, 2) + '\n');
const bad = blocks.filter((b) => b.exitCode === 0);
if (bad.length) {
  console.error('막혀야 하는데 통과한 검사: ' + bad.map((b) => b.title).join(', '));
  process.exit(1);
}
console.log(`명세 불일치 시험: ${blocks.length}건 모두 검사가 실패로 막음`);
