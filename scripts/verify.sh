#!/usr/bin/env bash
# 배포 전 관문. 앞 단계가 실패하면 거기서 멈춘다(CI 에 그대로 옮길 수 있는 순서).
#  1 형식·린트·타입  2 명세와 생성물 일치  3 단위  4 계약  5 통합(실제 PG·Redis)  6 e2e(compose + Playwright)  7 증거 수집·사이트 빌드·브라우저 시험  8 문서 대조·담당자 검사
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '\n== %s ==\n' "$*"; }
rm -rf .test-results docs/evidence/test-results.json
mkdir -p .test-results/kotlin
kt() { # Kotlin 시험을 돌리고 결과 XML 을 모아 둔다(다음 실행이 지우므로)
  bash scripts/gradle.sh :server:test "$@" --console=plain 2>&1 | grep -E 'PASSED|FAILED|SKIPPED|BUILD|tests completed' | awk '{c[$NF]++} /BUILD|tests completed|FAILED/ {print} END {printf "통과 %d, 실패 %d (Kotlin)\n", c["PASSED"], c["FAILED"]}'
  test "${PIPESTATUS[0]}" -eq 0
  cp server/build/test-results/test/*.xml .test-results/kotlin/
}

step "1. 형식·린트·타입 검사"
npx prettier --check "{packages,apps,web-demo,e2e,scripts}/**/*.{ts,tsx,mjs,css}" >/dev/null
echo "prettier 통과"
npx eslint .
echo "eslint 통과"
for d in packages/sync-core apps/web apps/player web-demo; do (cd "$d" && npx tsc --noEmit)
  echo "tsc 통과: $d"; done
bash scripts/gradle.sh :server:compileKotlin :server:compileTestKotlin -q
echo "kotlin 컴파일 통과"

step "2. 명세와 생성물(이벤트 스키마·TS 타입) 일치"
node scripts/spec-export.mjs --check

step "3. 단위 테스트 (TypeScript, Kotlin 도메인: 같은 벡터)"
npx vitest run --root packages/sync-core 2>&1 | grep -E 'Tests|Test Files|FAIL|×' ; test "${PIPESTATUS[0]}" -eq 0
npx vitest run --root apps/web 2>&1 | grep -E 'Tests|Test Files|FAIL|×' ; test "${PIPESTATUS[0]}" -eq 0
kt --tests '*VectorsTest' --tests '*BillingEvidenceTest'

step "4. 계약 테스트 (서버 응답 ↔ OpenAPI)"
kt --tests '*ContractIT'

step "5. 통합 테스트 (실제 PostgreSQL·Redis)"
kt --tests '*CommandIT' --tests '*RecordsAndBillingIT' --tests '*MigrationTest'

step "6. e2e (compose 전체 + Playwright, 마지막은 배포 되돌리기)"
bash scripts/e2e.sh 2>&1 | grep -E '✓|✘|passed|failed|Error|expected' ; test "${PIPESTATUS[0]}" -eq 0

step "7. 증거 수집, 데모 사이트 빌드와 브라우저 시험"
node scripts/evidence.mjs
node scripts/spec-drift.mjs
node web-demo/build.mjs
(cd web-demo && npx playwright test 2>&1 | grep -E '✓|✘|passed|failed|Error' ; test "${PIPESTATUS[0]}" -eq 0)
node scripts/evidence.mjs
node web-demo/build.mjs

step "8. 테스트 케이스 문서 대조, 담당자 검사"
node scripts/check-test-cases.mjs
node scripts/check-owners.mjs

printf '\nverify 통과\n'
