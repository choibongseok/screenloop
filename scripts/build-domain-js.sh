#!/usr/bin/env bash
# 서버 도메인(Kotlin Multiplatform)을 JavaScript 로 컴파일해 build/domain-js/ 에 모은다.
# 데모 사이트와 sync-core 의 시험이 이 산출물을 불러, 브라우저·Node 에서도 JVM 서버와 같은 Kotlin 코드가 돈다.
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/gradle.sh :domain:jsProductionExecutableCompileSync -q
rm -rf build/domain-js && mkdir -p build/domain-js
cp domain/build/compileSync/js/main/productionExecutable/kotlin/*.mjs build/domain-js/
# 소스맵 참조는 떼어 둔다(맵 파일은 싣지 않는다)
for f in build/domain-js/*.mjs; do sed -i.bak '/^\/\/# sourceMappingURL=/d' "$f" && rm -f "$f.bak"; done
echo "build/domain-js: $(du -sh build/domain-js | cut -f1) (screenloop-domain.mjs $(wc -c < build/domain-js/screenloop-domain.mjs) bytes)"
