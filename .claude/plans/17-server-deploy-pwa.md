# feat(deploy): 서버 배포 + 자동 발송처리 + PWA 대시보드

## 이슈
- 번호: #17
- 브랜치: `feat/17-server-deploy-pwa`
- **의존성:** PR #16 (feat/7-dispatch-automation) 머지 필요

## 개요
Oracle Cloud VM에 앱을 배포하여:
1. 고정 IP로 네이버 API 화이트리스트 문제 해결
2. 서버에서 5분마다 GS택배 운송장번호 자동 스크래핑 + 네이버 발송처리
3. PWA로 모바일에서 대시보드 확인 가능

## 아키텍처

```
[Oracle Cloud VM - Ubuntu]
├── Caddy (리버스 프록시, 자동 HTTPS)
├── PM2 (프로세스 매니저)
├── Next.js 프로덕션 앱
│   ├── 대시보드 UI (모바일 PWA)
│   ├── 네이버 API (주문조회, 발송처리)
│   ├── Playwright headless (GS택배 운송장 스크래핑)
│   ├── dispatch-worker (5분 폴링)
│   └── SQLite DB
└── data/cookies.json (로컬에서 동기화)

[로컬 PC]
├── Next.js 개발 앱 (기존 그대로)
├── Playwright headed (GS택배 예약 + 캡챠)
└── 예약 완료 시 → 서버 API로 결과+쿠키 동기화
```

## 변경 파일 목록

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `ecosystem.config.cjs` | 신규 | PM2 프로세스 설정 |
| `Caddyfile` | 신규 | Caddy 리버스 프록시 + HTTPS |
| `scripts/deploy.sh` | 신규 | 서버 초기 설정 + 배포 스크립트 |
| `src/lib/gs-delivery/browser.ts` | 수정 | headless 모드 지원 (DEPLOY_MODE) |
| `src/app/api/internal/cookies/route.ts` | 신규 | 쿠키 동기화 API |
| `src/app/api/internal/booking-result/route.ts` | 신규 | 예약결과 동기화 API |
| `src/lib/sync-to-server.ts` | 신규 | 로컬→서버 동기화 유틸 |
| `src/lib/gs-delivery/worker.ts` | 수정 | 예약 완료 시 서버 동기화 호출 |
| `src/lib/gs-delivery/auth.ts` | 수정 | 로그인 성공 시 쿠키 서버 동기화 |
| `public/manifest.json` | 신규 | PWA 매니페스트 |
| `public/sw.js` | 신규 | 서비스 워커 |
| `public/icons/icon-192.png` | 신규 | PWA 아이콘 |
| `public/icons/icon-512.png` | 신규 | PWA 아이콘 |
| `src/app/layout.tsx` | 수정 | PWA 메타태그 + manifest 링크 |
| `next.config.ts` | 수정 | PWA 헤더 설정 |
| `.env.local.example` | 수정 | 서버 배포 관련 환경변수 추가 |
| `package.json` | 수정 | deploy 스크립트 추가 |
| `docs/project-history.md` | 수정 | Phase 6 기록 |

## 구현 상세

### 1. 서버 배포 인프라

#### 1-1. 환경변수 추가

**파일:** `.env.local.example`

**After:**
```env
# 네이버 커머스 API
NAVER_CLIENT_ID=your_client_id_here
NAVER_CLIENT_SECRET=your_client_secret_here

# GS택배 (cvsnet.co.kr)
GS_USERNAME=your_username_here
GS_PASSWORD=your_password_here

# 보내는 사람 기본 정보
SENDER_NAME=홍길동
SENDER_PHONE=010-1234-5678
SENDER_ZIPCODE=12345
SENDER_ADDRESS=서울특별시 강남구 역삼동
SENDER_ADDRESS_DETAIL=123호

# === 서버 배포 설정 ===

# 배포 모드: "server" = 서버(headless), "local" = 로컬(headed)
# 미설정 시 "local"로 동작 (기존 동작 유지)
DEPLOY_MODE=local

# 서버 URL (로컬에서 서버로 동기화할 때 사용)
# 로컬 .env.local에만 설정 (서버에서는 불필요)
SERVER_URL=https://ship.yourdomain.com

# 내부 API 인증 키 (로컬↔서버 통신용)
# 서버와 로컬 모두 동일한 값 설정 필요
INTERNAL_API_KEY=your_random_secret_key_here
```

**설명:** `DEPLOY_MODE`로 서버/로컬 동작 분기. 기존 동작(headed)이 기본값이라 하위 호환 유지.

#### 1-2. browser.ts headless 모드 지원

**파일:** `src/lib/gs-delivery/browser.ts`

**Before:**
```typescript
export async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;

  browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });
```

**After:**
```typescript
const isServerMode = () => process.env.DEPLOY_MODE === "server";

export async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;

  browser = await chromium.launch({
    headless: isServerMode(),
    args: [
      "--disable-blink-features=AutomationControlled",
      // headless 서버에서 필요한 추가 옵션
      ...(isServerMode()
        ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
        : []),
    ],
  });
```

**설명:** 서버에서는 headless + Linux 호환 옵션 추가. `--no-sandbox`는 Docker/VM 환경에서 필수. `--disable-dev-shm-usage`는 메모리 부족 방지.

#### 1-3. PM2 설정

**파일:** `ecosystem.config.cjs` (신규)

```javascript
module.exports = {
  apps: [
    {
      name: "smart-ship",
      script: "node_modules/.bin/next",
      args: "start",
      cwd: "/home/ubuntu/smart-ship-automation",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      // 자동 재시작
      max_memory_restart: "500M",
      // 로그
      error_file: "./logs/error.log",
      out_file: "./logs/out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
```

#### 1-4. Caddy 설정

**파일:** `Caddyfile` (신규)

```
{$DOMAIN:ship.example.com} {
    reverse_proxy localhost:3000
}
```

**설명:** Caddy는 자동으로 Let's Encrypt SSL 인증서를 발급/갱신한다. `$DOMAIN`은 환경변수로 실제 도메인 설정.

#### 1-5. 배포 스크립트

**파일:** `scripts/deploy.sh` (신규)

```bash
#!/bin/bash
set -e

echo "=== Smart Ship Automation 서버 배포 ==="

# 1. 시스템 패키지 업데이트
echo "[1/7] 시스템 업데이트..."
sudo apt-get update -y

# 2. Playwright 시스템 의존성 설치
echo "[2/7] Playwright 의존성 설치..."
npx playwright install-deps chromium
npx playwright install chromium

# 3. Caddy 설치
echo "[3/7] Caddy 설치..."
if ! command -v caddy &> /dev/null; then
    sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
    sudo apt-get update -y
    sudo apt-get install -y caddy
fi

# 4. PM2 설치
echo "[4/7] PM2 설치..."
npm install -g pm2 2>/dev/null || true

# 5. 앱 빌드
echo "[5/7] 앱 빌드..."
npm ci --production=false
npm run build

# 6. 필수 디렉토리 생성
echo "[6/7] 디렉토리 생성..."
mkdir -p data logs

# 7. PM2로 앱 시작
echo "[7/7] 앱 시작..."
pm2 stop smart-ship 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

echo ""
echo "=== 배포 완료 ==="
echo "Caddy 설정: sudo cp Caddyfile /etc/caddy/Caddyfile"
echo "Caddy 시작: sudo systemctl restart caddy"
echo "도메인 DNS A 레코드를 서버 IP로 설정하세요."
echo ""
echo "서버 상태: pm2 status"
echo "서버 로그: pm2 logs smart-ship"
```

#### 1-6. package.json 스크립트 추가

**파일:** `package.json`

**Before:**
```json
"scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint"
}
```

**After:**
```json
"scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "deploy": "bash scripts/deploy.sh"
}
```

---

### 2. 로컬↔서버 동기화 API

#### 2-1. 동기화 유틸리티

**파일:** `src/lib/sync-to-server.ts` (신규)

```typescript
/**
 * 로컬 → 서버 동기화 유틸리티.
 * DEPLOY_MODE=local일 때만 동작.
 * SERVER_URL과 INTERNAL_API_KEY가 설정되지 않으면 무시 (기존 동작 유지).
 */

const getServerUrl = () => process.env.SERVER_URL;
const getApiKey = () => process.env.INTERNAL_API_KEY;

function canSync(): boolean {
  return (
    process.env.DEPLOY_MODE !== "server" && !!getServerUrl() && !!getApiKey()
  );
}

async function postToServer(
  endpoint: string,
  data: unknown
): Promise<boolean> {
  if (!canSync()) return false;

  const url = `${getServerUrl()}${endpoint}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": getApiKey()!,
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      console.warn(
        `[sync] 서버 동기화 실패 (${endpoint}): ${res.status} ${res.statusText}`
      );
      return false;
    }

    console.log(`[sync] 서버 동기화 성공: ${endpoint}`);
    return true;
  } catch (err) {
    console.warn(
      `[sync] 서버 연결 실패 (${endpoint}):`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/** 예약 결과를 서버에 동기화 */
export async function syncBookingResult(data: {
  orderId: string;
  orderDbIds: number[];
  status: "booked" | "failed";
  bookingResult?: string;
  bookingReservationNo?: string;
  error?: string;
}): Promise<boolean> {
  return postToServer("/api/internal/booking-result", data);
}

/** GS택배 쿠키를 서버에 동기화 */
export async function syncCookiesToServer(
  cookies: Array<Record<string, unknown>>
): Promise<boolean> {
  return postToServer("/api/internal/cookies", { cookies });
}
```

**설명:** `SERVER_URL`/`INTERNAL_API_KEY`가 없으면 동기화를 건너뛴다. 기존 로컬 전용 사용자는 아무 영향 없음.

#### 2-2. 쿠키 동기화 API (서버)

**파일:** `src/app/api/internal/cookies/route.ts` (신규)

```typescript
import fs from "fs";
import path from "path";

import { NextRequest, NextResponse } from "next/server";

const COOKIES_PATH = path.join(process.cwd(), "data", "cookies.json");

/** POST /api/internal/cookies — 로컬에서 GS택배 쿠키 수신 */
export async function POST(request: NextRequest) {
  // API 키 인증
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      cookies?: Array<Record<string, unknown>>;
    };
    if (!body.cookies || !Array.isArray(body.cookies)) {
      return NextResponse.json(
        { error: "cookies 배열이 필요합니다" },
        { status: 400 }
      );
    }

    const dir = path.dirname(COOKIES_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(body.cookies, null, 2));

    console.log(
      `[internal/cookies] 쿠키 동기화 완료 (${body.cookies.length}개)`
    );
    return NextResponse.json({
      message: `쿠키 ${body.cookies.length}개 저장 완료`,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

#### 2-3. 예약결과 동기화 API (서버)

**파일:** `src/app/api/internal/booking-result/route.ts` (신규)

```typescript
import { NextRequest, NextResponse } from "next/server";

import {
  updateOrderStatusBatch,
  addBookingLog,
} from "@/lib/orders";

import type { OrderStatus } from "@/types";

/** POST /api/internal/booking-result — 로컬에서 예약 결과 수신 */
export async function POST(request: NextRequest) {
  // API 키 인증
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      orderId: string;
      orderDbIds: number[];
      status: OrderStatus;
      bookingResult?: string;
      bookingReservationNo?: string;
      error?: string;
    };

    if (!body.orderId || !body.orderDbIds?.length || !body.status) {
      return NextResponse.json(
        { error: "orderId, orderDbIds, status가 필요합니다" },
        { status: 400 }
      );
    }

    // 서버 DB에도 해당 주문이 있어야 함 (Naver 동기화로 이미 존재)
    // orderDbIds는 서버와 로컬 DB의 id가 다를 수 있으므로
    // orderId 기준으로 서버 DB를 업데이트
    // → orders.ts에 orderId 기준 업데이트 함수 필요

    if (body.status === "booked") {
      updateOrdersByOrderId(
        body.orderId,
        "booked",
        body.bookingResult,
        body.bookingReservationNo
      );
      addBookingLogByOrderId(
        body.orderId,
        "complete",
        `예약 완료 (로컬 동기화)${body.bookingReservationNo ? `: ${body.bookingReservationNo}` : ""}`
      );
    } else if (body.status === "failed") {
      updateOrdersByOrderId(body.orderId, "failed", body.error);
      addBookingLogByOrderId(
        body.orderId,
        "error",
        `예약 실패 (로컬 동기화): ${body.error ?? "알 수 없는 오류"}`
      );
    }

    console.log(
      `[internal/booking-result] ${body.orderId}: ${body.status}` +
        (body.bookingReservationNo
          ? ` (예약번호: ${body.bookingReservationNo})`
          : "")
    );

    return NextResponse.json({ message: "동기화 완료", orderId: body.orderId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

**추가 필요:** `src/lib/orders.ts`에 orderId 기준 업데이트 함수 추가

```typescript
/** orderId 기준으로 주문 상태 일괄 업데이트 (서버 동기화용) */
export function updateOrdersByOrderId(
  orderId: string,
  status: OrderStatus,
  bookingResult?: string,
  bookingReservationNo?: string
): void {
  db.update(orders)
    .set({
      status,
      bookingResult: bookingResult ?? null,
      bookingReservationNo: bookingReservationNo ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(orders.orderId, orderId))
    .run();
}

/** orderId 기준으로 첫 번째 DB id를 찾아 로그 기록 (서버 동기화용) */
export function addBookingLogByOrderId(
  orderId: string,
  action: string,
  detail?: string
): void {
  const first = db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.orderId, orderId))
    .get();
  if (first) {
    addBookingLog(first.id, action, detail);
  }
}
```

---

### 3. 로컬 예약 완료 시 서버 동기화

#### 3-1. worker.ts — 예약 완료 후 서버 동기화

**파일:** `src/lib/gs-delivery/worker.ts`

`processSingleOrder` 함수의 결과 처리 부분에 동기화 호출을 추가한다.

**Before:**
```typescript
    if (result.success) {
      updateOrderStatusBatch(
        task.orderDbIds,
        "booked",
        JSON.stringify({ reservationNo: result.reservationNo }),
        result.reservationNo
      );
      addBookingLog(
        logId,
        "complete",
        `예약 완료${result.reservationNo ? `: ${result.reservationNo}` : ""}`
      );
```

**After:**
```typescript
    if (result.success) {
      updateOrderStatusBatch(
        task.orderDbIds,
        "booked",
        JSON.stringify({ reservationNo: result.reservationNo }),
        result.reservationNo
      );
      addBookingLog(
        logId,
        "complete",
        `예약 완료${result.reservationNo ? `: ${result.reservationNo}` : ""}`
      );

      // 서버에 예약 결과 동기화 (비동기, 실패해도 로컬 동작에 영향 없음)
      void syncBookingResult({
        orderId: task.naverOrderId,
        orderDbIds: task.orderDbIds,
        status: "booked",
        bookingResult: JSON.stringify({ reservationNo: result.reservationNo }),
        bookingReservationNo: result.reservationNo,
      });
```

**실패 시에도 동기화:**
```typescript
    } else {
      updateOrderStatusBatch(
        task.orderDbIds,
        "failed",
        result.error ?? "알 수 없는 오류"
      );
      // ... 기존 로깅 ...

      // 서버에 실패 결과 동기화
      void syncBookingResult({
        orderId: task.naverOrderId,
        orderDbIds: task.orderDbIds,
        status: "failed",
        error: result.error ?? "알 수 없는 오류",
      });
```

**설명:** `void`로 비동기 호출하여 서버 동기화 실패가 로컬 흐름을 방해하지 않음. `syncBookingResult`는 `canSync()=false`이면 즉시 리턴.

#### 3-2. auth.ts — 로그인 후 쿠키 서버 동기화

**파일:** `src/lib/gs-delivery/auth.ts`

**Before:**
```typescript
    // 로그인 쿠키 저장 → 다음 실행 시 재사용
    await saveCookies();
```

**After:**
```typescript
    // 로그인 쿠키 저장 → 다음 실행 시 재사용
    await saveCookies();

    // 서버에도 쿠키 동기화 (서버 headless 스크래핑용)
    await syncCookiesAfterLogin();
```

**새 함수 추가 (auth.ts 하단):**
```typescript
import { syncCookiesToServer } from "@/lib/sync-to-server";

/** 로그인 성공 후 쿠키를 서버에 동기화 */
async function syncCookiesAfterLogin(): Promise<void> {
  try {
    const cookiesPath = path.join(process.cwd(), "data", "cookies.json");
    if (!fs.existsSync(cookiesPath)) return;
    const raw = fs.readFileSync(cookiesPath, "utf-8");
    const cookies = JSON.parse(raw);
    await syncCookiesToServer(cookies);
  } catch {
    // 동기화 실패해도 로컬 동작에 영향 없음
    console.warn("[auth] 쿠키 서버 동기화 실패 (무시)");
  }
}
```

**필요한 import 추가:**
```typescript
import fs from "fs";
import path from "path";
```

---

### 4. PWA 모바일 대시보드

#### 4-1. manifest.json

**파일:** `public/manifest.json` (신규)

```json
{
  "name": "Smart Ship Automation",
  "short_name": "SmartShip",
  "description": "네이버 스마트스토어 주문 자동 발송",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#171717",
  "orientation": "portrait",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

#### 4-2. 서비스 워커

**파일:** `public/sw.js` (신규)

```javascript
const CACHE_NAME = "smart-ship-v1";
const STATIC_ASSETS = ["/", "/manifest.json"];

// 설치: 정적 자산 캐시
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// 활성화: 이전 캐시 정리
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// 페치: Network-first (API는 항상 네트워크, 정적 자산은 캐시 폴백)
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API 요청은 항상 네트워크
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 성공 시 캐시 업데이트
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
```

#### 4-3. 앱 아이콘

**파일:** `public/icons/icon-192.png`, `public/icons/icon-512.png` (신규)

SVG를 Canvas로 변환하여 PNG 생성하는 스크립트를 만들거나, 간단한 플레이스홀더 아이콘을 생성한다.

아이콘 생성 방법: `scripts/generate-icons.ts`를 만들어 실행하거나, 간단한 컬러 사각형 PNG를 sharp 또는 canvas로 생성한다. 여기서는 빌드 의존성을 추가하지 않기 위해 1x1 PNG를 base64로 생성 후 사용자가 교체하도록 안내한다.

**대안:** `public/icons/icon.svg` 하나만 만들고 manifest에서 SVG를 직접 참조:

```json
{
  "src": "/icons/icon.svg",
  "sizes": "any",
  "type": "image/svg+xml"
}
```

SVG 아이콘 내용 (간단한 로고):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="64" fill="#171717"/>
  <text x="256" y="300" text-anchor="middle" font-size="240" font-weight="bold" fill="white" font-family="system-ui">S</text>
</svg>
```

PNG 아이콘은 이 SVG를 기반으로 사용자가 나중에 교체할 수 있다. 빌드 시 PNG가 필요한 브라우저를 위해 192/512 PNG도 함께 생성한다.

#### 4-4. layout.tsx PWA 메타태그

**파일:** `src/app/layout.tsx`

**Before:**
```typescript
export const metadata: Metadata = {
  title: "Smart Ship Automation",
  description: "네이버 스마트스토어 주문 → GS택배 자동 예약",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

**After:**
```typescript
export const metadata: Metadata = {
  title: "Smart Ship Automation",
  description: "네이버 스마트스토어 주문 → GS택배 자동 예약",
  manifest: "/manifest.json",
  themeColor: "#171717",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SmartShip",
  },
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body>
        <Providers>{children}</Providers>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('/sw.js');
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
```

**설명:** Next.js Metadata API로 PWA 관련 메타태그 추가. 서비스 워커는 클라이언트에서만 등록.

---

### 5. next.config.ts 업데이트

**파일:** `next.config.ts`

**Before:**
```typescript
const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "playwright"],
};
```

**After:**
```typescript
const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "playwright"],
  headers: async () => [
    {
      source: "/sw.js",
      headers: [
        {
          key: "Service-Worker-Allowed",
          value: "/",
        },
        {
          key: "Cache-Control",
          value: "no-cache",
        },
      ],
    },
  ],
};
```

**설명:** 서비스 워커 파일에 적절한 헤더 설정. 캐시 방지로 업데이트 즉시 반영.

---

## 커밋 계획

1. `feat(deploy): 서버 배포 인프라 + headless Playwright 지원` — ecosystem.config.cjs, Caddyfile, scripts/deploy.sh, browser.ts, .env.local.example, package.json
2. `feat(api): 로컬↔서버 동기화 API + 예약결과 자동 동기화` — internal/cookies/route.ts, internal/booking-result/route.ts, sync-to-server.ts, orders.ts, worker.ts, auth.ts
3. `feat(pwa): PWA 모바일 대시보드` — manifest.json, sw.js, icons, layout.tsx, next.config.ts
4. `docs: Phase 6 프로젝트 히스토리 업데이트` — project-history.md

## 테스트 계획

- [ ] `npm run build` 프로덕션 빌드 성공
- [ ] `DEPLOY_MODE=server` 설정 시 headless 브라우저 실행 확인
- [ ] `DEPLOY_MODE=local` (기본) 시 기존 headed 동작 유지
- [ ] `/api/internal/cookies` POST 시 쿠키 파일 저장 확인
- [ ] `/api/internal/booking-result` POST 시 DB 업데이트 확인
- [ ] API 키 없이 internal 엔드포인트 호출 시 401 반환
- [ ] manifest.json 접근 가능 + PWA 설치 프롬프트 확인
- [ ] 서비스 워커 등록 확인

## 체크리스트

- [ ] 프로젝트 컨벤션 규칙 준수
- [ ] 민감 정보 하드코딩 없음 (INTERNAL_API_KEY는 .env에서만)
- [ ] 타입 안전성 확인
- [ ] 에러 핸들링 포함
- [ ] 기존 로컬 전용 동작에 영향 없음 (하위 호환)

## 프로젝트 히스토리 기록

```markdown
### Phase 6: 서버 배포 + 자동 발송처리 + PWA
- **완료일:** 2026-03-16
- **이슈:** #17
- **주요 변경:**
  - Oracle Cloud VM 배포 (PM2 + Caddy + 자동 HTTPS)
  - headless Playwright로 GS택배 운송장 자동 스크래핑
  - 로컬 예약 완료 시 서버 자동 동기화 (쿠키 + 예약결과)
  - 5분 폴링으로 운송장 감지 → 네이버 자동 발송처리
  - PWA 대시보드 (모바일 홈화면 설치 가능)
- **아키텍처:**
  - 서버: Next.js 프로덕션 + DB + 자동 발송 + 대시보드
  - 로컬: GS택배 Playwright 예약 (headed) + 서버 동기화
- **배포 방법:** `npm run deploy` → PM2 + Caddy 자동 설정
```
