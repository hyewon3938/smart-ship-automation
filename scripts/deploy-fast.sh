#!/bin/bash
set -euo pipefail

# .env.local에서 DEPLOY_* 설정만 로드 (다른 변수의 공백/특수문자 영향 회피)
if [ -f .env.local ]; then
  while IFS= read -r line; do
    case "$line" in
      DEPLOY_*=*) export "$line" ;;
    esac
  done < .env.local
fi

: "${DEPLOY_SSH_HOST:?DEPLOY_SSH_HOST 미설정 (.env.local 확인)}"
: "${DEPLOY_SSH_KEY:?DEPLOY_SSH_KEY 미설정 (.env.local 확인)}"
: "${DEPLOY_REMOTE_PATH:?DEPLOY_REMOTE_PATH 미설정 (.env.local 확인)}"

SSH_KEY="${DEPLOY_SSH_KEY/#\~/$HOME}"
SERVER="$DEPLOY_SSH_HOST"
REMOTE="$DEPLOY_REMOTE_PATH"

SSH_OPTS=(-i "$SSH_KEY" -o ServerAliveInterval=30)
RSYNC_SSH="ssh ${SSH_OPTS[*]}"

step() { echo ""; echo "=== $* ==="; }

step "[1/5] 로컬 빌드"
time npm run build

step "[2/5] standalone 전송"
# Mac에서 빌드된 .node 네이티브 바이너리, 로컬 data/, .env.local 은 제외
rsync -az --delete \
  -e "$RSYNC_SSH" \
  --exclude='/data' \
  --exclude='/.env.local' \
  --exclude='**/build/Release/*.node' \
  --exclude='**/prebuilds/darwin*/**' \
  .next/standalone/ \
  "$SERVER:$REMOTE/.next/standalone/"

step "[3/5] static + public + 런타임 config 전송"
rsync -az --delete -e "$RSYNC_SSH" \
  .next/static/ \
  "$SERVER:$REMOTE/.next/standalone/.next/static/"
rsync -az --delete -e "$RSYNC_SSH" \
  public/ \
  "$SERVER:$REMOTE/.next/standalone/public/"
rsync -az -e "$RSYNC_SSH" \
  ecosystem.config.cjs \
  "$SERVER:$REMOTE/ecosystem.config.cjs"

step "[4/5] 서버 설정 (symlink + native 바이너리)"
ssh "${SSH_OPTS[@]}" "$SERVER" "bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail
cd /home/ubuntu/smart-ship-automation/.next/standalone

# data, .env.local 을 프로젝트 루트 원본으로 symlink
if [ ! -L data ]; then
  rm -rf data
  ln -s ../../data data
fi
if [ ! -L .env.local ]; then
  rm -f .env.local
  ln -s ../../.env.local .env.local
fi

# Linux 네이티브 바이너리를 서버의 기존 node_modules에서 복사
mkdir -p node_modules/better-sqlite3/build/Release
cp -f /home/ubuntu/smart-ship-automation/node_modules/better-sqlite3/build/Release/better_sqlite3.node \
      node_modules/better-sqlite3/build/Release/better_sqlite3.node
REMOTE_SCRIPT

step "[5/5] 앱 재시작 (ecosystem config 반영)"
# pm2 restart 만으로는 require 캐시가 갱신되지 않는 경우가 있어 delete + start 로 강제 재기동
ssh "${SSH_OPTS[@]}" "$SERVER" "cd $REMOTE && pm2 delete smart-ship 2>/dev/null || true && pm2 start ecosystem.config.cjs && pm2 save"

echo ""
echo "✅ 배포 완료"
