#!/usr/bin/env bash
# web-demo/dist 를 gh-pages 브랜치에 로컬 커밋한다. push 는 하지 않는다. main 작업 트리는 건드리지 않는다(임시 worktree 사용).
# Pages 설정(한 번만): 저장소 Settings > Pages > Source = Deploy from a branch, Branch = gh-pages / (root).
# 공개하려면: git push origin gh-pages
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
for f in docs/evidence/test-results.json docs/evidence/billing-run.json docs/evidence/e2e-billing.json docs/evidence/spec-drift.json; do
  [ -s "$f" ] || { echo "증거 파일이 없음: $f (make verify 를 먼저 실행)" >&2; exit 1; }
done
node web-demo/build.mjs
src_sha="$(git rev-parse --short HEAD)"
wt="$(mktemp -d)"
trap 'git -C "$root" worktree remove --force "$wt" >/dev/null 2>&1 || true' EXIT
if git show-ref --verify --quiet refs/heads/gh-pages; then
  git worktree add "$wt" gh-pages >/dev/null
else
  git worktree add --detach "$wt" >/dev/null
  git -C "$wt" checkout --orphan gh-pages >/dev/null 2>&1
  git -C "$wt" rm -r -q -f . >/dev/null 2>&1 || true
fi
git -C "$wt" rm -r -q -f --ignore-unmatch . >/dev/null 2>&1 || true
cp -R web-demo/dist/. "$wt"/
git -C "$wt" add -A
if git -C "$wt" diff --cached --quiet; then
  echo "변경 없음: gh-pages 는 이미 최신"
else
  git -C "$wt" commit -q -m "chore(pages): 정적 데모 배포 (main ${src_sha} 기준)"
  echo "gh-pages 커밋 완료. 공개하려면: git push origin gh-pages"
fi
