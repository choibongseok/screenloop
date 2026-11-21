#!/usr/bin/env bash
# 서버 jar, 웹(Next standalone), 플레이어(정적)를 빌드해 이미지 세 개를 만든다. 태그는 SCREENLOOP_VERSION (기본 dev).
set -euo pipefail
cd "$(dirname "$0")/.."
export SCREENLOOP_VERSION="${SCREENLOOP_VERSION:-dev}"
bash scripts/gradle.sh :server:bootJar -q
npm run build -w @screenloop/web --silent
npm run build -w @screenloop/player --silent
docker compose build server web player
