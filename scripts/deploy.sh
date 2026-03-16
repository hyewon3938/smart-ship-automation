#!/bin/bash
set -e

echo "=== Smart Ship Automation 서버 배포 ==="

# 1. Playwright 시스템 의존성 설치
echo "[1/6] Playwright 의존성 설치..."
npx playwright install-deps chromium
npx playwright install chromium

# 2. Caddy 설치 (미설치 시)
echo "[2/6] Caddy 확인..."
if ! command -v caddy &> /dev/null; then
    sudo apt-get update -y
    sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
        | sudo tee /etc/apt/sources.list.d/caddy-stable.list
    sudo apt-get update -y
    sudo apt-get install -y caddy
    echo "Caddy 설치 완료"
else
    echo "Caddy 이미 설치됨"
fi

# 3. PM2 설치 (미설치 시)
echo "[3/6] PM2 확인..."
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
    echo "PM2 설치 완료"
else
    echo "PM2 이미 설치됨"
fi

# 4. 앱 빌드
echo "[4/6] 앱 빌드..."
npm ci
npm run build

# 5. 필수 디렉토리 생성
echo "[5/6] 디렉토리 생성..."
mkdir -p data logs

# 6. PM2로 앱 시작
echo "[6/6] 앱 시작..."
pm2 stop smart-ship 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup 2>/dev/null || true

echo ""
echo "=== 배포 완료 ==="
echo ""
echo "다음 단계:"
echo "  1. Caddyfile의 도메인을 실제 도메인으로 수정"
echo "     DOMAIN=ship.yourdomain.com 환경변수 설정 또는 Caddyfile 직접 수정"
echo "  2. sudo cp Caddyfile /etc/caddy/Caddyfile"
echo "  3. sudo systemctl restart caddy"
echo "  4. 도메인 DNS A 레코드를 서버 공인 IP로 설정"
echo "  5. 네이버 커머스 개발자 센터에서 서버 공인 IP를 화이트리스트에 추가"
echo ""
echo "서버 상태 확인: pm2 status"
echo "서버 로그 확인: pm2 logs smart-ship"
