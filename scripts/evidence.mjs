// 테스트 결과 파일에서 종류별 통과·실패 수를 모아 docs/evidence/test-results.json 으로 쓴다(데모 사이트가 읽는다).
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';

const vitest = (f) => {
  if (!existsSync(f)) return { passed: 0, failed: 0 };
  const r = JSON.parse(readFileSync(f, 'utf8'));
  return { passed: r.numPassedTests, failed: r.numFailedTests };
};
const junit = (re) => {
  const dir = '.test-results/kotlin';
  let passed = 0,
    failed = 0;
  if (!existsSync(dir)) return { passed, failed };
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.xml') && re.test(x))) {
    const t = readFileSync(`${dir}/${f}`, 'utf8');
    const total = Number(/tests="(\d+)"/.exec(t)?.[1] ?? 0),
      bad = Number(/failures="(\d+)"/.exec(t)?.[1] ?? 0) + Number(/errors="(\d+)"/.exec(t)?.[1] ?? 0);
    passed += total - bad;
    failed += bad;
  }
  return { passed, failed };
};
const pw = (f) => {
  if (!existsSync(f)) return { passed: 0, failed: 0 };
  const r = JSON.parse(readFileSync(f, 'utf8'));
  return { passed: r.stats.expected, failed: r.stats.unexpected };
};
const sum = (...xs) => ({ passed: xs.reduce((n, x) => n + x.passed, 0), failed: xs.reduce((n, x) => n + x.failed, 0) });

const rows = [
  {
    kind: '단위',
    label: '동기화 핵심(sync-core): 이벤트 적용·충돌 규칙·시계 보정·재생 기록 대기열·클라이언트·플레이어 엔진, 속성 기반 시험, 명세 벡터',
    ...vitest('.test-results/sync-core.json'),
  },
  { kind: '단위', label: '웹 입력 검사와 안내 문구', ...vitest('.test-results/web.json') },
  { kind: '단위', label: '서버 도메인(Kotlin): 같은 벡터로 판정·기록 기준·정산 계산', ...junit(/VectorsTest|BillingEvidence/) },
  { kind: '계약', label: '서버 응답이 OpenAPI 명세와 같은지(모든 작업 호출, 오류 응답 포함)', ...junit(/ContractIT/) },
  { kind: '통합', label: '실제 PostgreSQL·Redis: 명령 순서·SSE·멱등 수집·월 마감·마이그레이션 되돌리기', ...junit(/CommandIT|RecordsAndBillingIT|MigrationTest/) },
  { kind: 'e2e', label: 'compose 전체 구성 + Playwright: 운영 웹 조작, 플레이어 두 대, 끊김, 정산, 배포 되돌리기', ...pw('.test-results/e2e.json') },
  { kind: '브라우저', label: '데모 사이트(실제 Chrome): 고장 내기 시나리오·정산 패널·설명 따라가기', ...pw('.test-results/demo.json') },
];
mkdirSync('docs/evidence', { recursive: true });
writeFileSync('docs/evidence/test-results.json', JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2) + '\n');
const t = sum(...rows);
console.log(`증거 수집: 통과 ${t.passed}, 실패 ${t.failed}`);
