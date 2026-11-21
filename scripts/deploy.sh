#!/usr/bin/env bash
# 배포: 새 버전 이미지로 server·web·player 를 교체하고 헬스 체크를 기다린다.
# 새 버전이 일정 시간 안에 정상이 되지 않으면 직전 버전으로 자동으로 되돌리고 1로 끝낸다. 데이터(PostgreSQL 볼륨)는 건드리지 않는다.
# 사용: scripts/deploy.sh <버전> [--skip-build]   (환경변수 SCREENLOOP_DB_URL 로 서버가 쓸 DB 를 바꿀 수 있다 — 잘못된 릴리스를 흉내 낼 때 쓴다)
set -euo pipefail
cd "$(dirname "$0")/.."
version="${1:?버전이 필요함 (예: 1.0.1)}"
state=.deploy; mkdir -p "$state"
previous="$(cat "$state/current" 2>/dev/null || true)"

if [ "${2:-}" != "--skip-build" ]; then
  SCREENLOOP_VERSION="$version" bash scripts/build-images.sh
fi

up() { SCREENLOOP_VERSION="$1" docker compose up -d --no-build --wait --wait-timeout "${DEPLOY_WAIT_SEC:-90}" "${@:2}"; }

echo "== 배포 시작: ${previous:-없음} -> $version"
docker compose up -d --no-build --wait postgres redis >/dev/null
if up "$version" server web player; then
  echo "$version" > "$state/current"
  [ -n "$previous" ] && [ "$previous" != "$version" ] && echo "$previous" > "$state/previous"
  echo "== 배포 완료: $version (헬스 체크 통과)"
else
  echo "== 헬스 체크 실패: $version" >&2
  docker compose logs --tail 20 server >&2 || true
  if [ -n "$previous" ]; then
    echo "== 직전 버전 $previous 로 되돌립니다" >&2
    SCREENLOOP_DB_URL= up "$previous" server web player
    echo "$previous" > "$state/current"
    echo "== 되돌리기 완료: $previous" >&2
  else
    echo "되돌릴 직전 버전이 없습니다" >&2
  fi
  exit 1
fi
