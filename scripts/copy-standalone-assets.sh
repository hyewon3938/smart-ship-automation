#!/bin/bash
# Next.js standalone 빌드 후 정적 자원 복사
# next build 는 .next/standalone/server.js 만 생성하고,
# .next/static 및 public 은 별도로 .next/standalone/.next/static, .next/standalone/public 에
# 복사해야 server.js 가 서빙할 수 있다.
set -euo pipefail

if [ ! -d ".next/standalone" ]; then
  echo "[copy-standalone-assets] .next/standalone 이 없어 건너뜀 (output: standalone 모드 아님)"
  exit 0
fi

mkdir -p .next/standalone/.next

# rsync 가 있으면 삭제 동기화, 없으면 cp -r (서버 첫 빌드 시 rsync 미설치 가능성 대비)
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete .next/static/ .next/standalone/.next/static/
  if [ -d "public" ]; then
    rsync -a --delete public/ .next/standalone/public/
  fi
else
  rm -rf .next/standalone/.next/static
  cp -r .next/static .next/standalone/.next/static
  if [ -d "public" ]; then
    rm -rf .next/standalone/public
    cp -r public .next/standalone/public
  fi
fi

echo "[copy-standalone-assets] static + public 복사 완료"
