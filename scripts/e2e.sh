#!/usr/bin/env bash
# e2e: compose 전체 구성을 처음부터(볼륨 포함) 올려 Playwright 로 운영 웹·플레이어·서버를 함께 조작하고, 끝나면 내린다.
# 마지막 시험(z-rollback)이 배포·되돌리기 스크립트를 실제로 돌리므로 이미지 빌드가 포함된다.
set -euo pipefail
cd "$(dirname "$0")/.."
cleanup() { docker compose down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf .deploy; }
trap cleanup EXIT
mkdir -p .test-results
docker compose down -v --remove-orphans >/dev/null 2>&1 || true
rm -rf .deploy
bash scripts/deploy.sh 1.0.0 >/dev/null
(cd e2e && npx playwright test 2>&1 | tee ../.test-results/e2e.log)
