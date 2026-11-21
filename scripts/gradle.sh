#!/usr/bin/env bash
# Gradle 래퍼 실행 도우미. Gradle 8.14 는 JDK 17~24 에서 돈다(25 는 불가).
# 빌드와 테스트 자체는 build.gradle.kts 의 툴체인 설정(JDK 21)을 따르고, 없으면 Gradle 이 내려받는다.
set -euo pipefail
cd "$(dirname "$0")/.."
major="$(java -version 2>&1 | sed -n '1s/.*"\([0-9]*\)[."].*/\1/p')"
if [ -z "$major" ] || [ "$major" -gt 24 ] || [ "$major" -lt 17 ]; then
  for v in 21 17 20 22 23 24; do
    if h="$(/usr/libexec/java_home -v "$v" 2>/dev/null)"; then export JAVA_HOME="$h"; break; fi
  done
fi
exec ./gradlew "$@"
