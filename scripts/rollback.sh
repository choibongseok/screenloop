#!/usr/bin/env bash
# 직전 버전(.deploy/previous)으로 되돌린다. 이미지가 로컬에 남아 있으므로 다시 빌드하지 않는다.
# 데이터베이스 변경까지 되돌려야 하면(옛 버전이 새 스키마에서 못 도는 경우) db/rollback/U<번호>__*.sql 을 새 번호부터 거꾸로 적용한다 — docs/ROLLBACK.md
set -euo pipefail
cd "$(dirname "$0")/.."
prev="$(cat .deploy/previous 2>/dev/null || true)"
[ -n "$prev" ] || { echo "직전 버전 기록(.deploy/previous)이 없습니다" >&2; exit 1; }
current="$(cat .deploy/current 2>/dev/null || true)"
echo "== 되돌리기: $current -> $prev"
SCREENLOOP_VERSION="$prev" docker compose up -d --no-build --wait --wait-timeout "${DEPLOY_WAIT_SEC:-90}" server web player
echo "$prev" > .deploy/current
echo "$current" > .deploy/previous
echo "== 완료: 실행 중 버전 $(curl -s http://127.0.0.1:59680/api/version)"
