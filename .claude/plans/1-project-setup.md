# chore(config): 프로젝트 초기 셋팅 (Next.js + TypeScript + Tailwind + SQLite)

## 이슈
- 번호: #1
- 브랜치: chore/1-project-setup

## 개요
Next.js 15 프로젝트를 초기화하고, 모든 의존성 설치, DB 스키마 정의, 프로젝트 디렉토리 구조를 생성한다. 이후 Phase들의 기반이 되는 셋팅.

## 변경 파일 목록

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `package.json` | 자동 생성 + 수정 | Next.js 초기화 후 추가 의존성 |
| `next.config.ts` | 수정 | serverExternalPackages 설정 |
| `tsconfig.json` | 자동 생성 | Next.js 기본 + path alias |
| `tailwind.config.ts` | 자동 생성 | shadcn/ui init으로 생성 |
| `postcss.config.mjs` | 자동 생성 | Tailwind 빌드용 |
| `src/app/layout.tsx` | 수정 | QueryClientProvider 래핑 |
| `src/app/page.tsx` | 수정 | 기본 페이지 → 간단한 대시보드 셸 |
| `src/app/globals.css` | 수정 | shadcn/ui CSS 변수 (자동 생성됨) |
| `src/components/providers.tsx` | 신규 생성 | QueryClientProvider 클라이언트 컴포넌트 |
| `src/lib/db/index.ts` | 신규 생성 | SQLite 연결 싱글턴 |
| `src/lib/db/schema.ts` | 신규 생성 | Drizzle ORM 스키마 (orders, settings, bookingLogs) |
| `drizzle.config.ts` | 신규 생성 | Drizzle Kit 마이그레이션 설정 |
| `src/lib/utils.ts` | 자동 생성 | shadcn/ui cn() 유틸 (자동 생성됨) |
| `vitest.config.ts` | 신규 생성 | Vitest 설정 |
| `.env.local.example` | 신규 생성 | 환경변수 템플릿 |
| `.gitignore` | 수정 | data/, .env.local 등 추가 |
| `src/types/index.ts` | 신규 생성 | 공유 타입 정의 (빈 파일, 향후 사용) |

## 구현 상세

### 1. Next.js 15 프로젝트 초기화

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
```

주의: 현재 디렉토리에 이미 파일이 있으므로 (docs/, CLAUDE.md, .claude/), `--yes` 플래그 없이 실행하여 기존 파일 덮어쓰기 방지. 만약 충돌 나면 빈 임시 디렉토리에서 생성 후 필요한 파일만 복사.

**설명:** Next.js 15 App Router + TypeScript + Tailwind CSS + ESLint를 한번에 초기화. src/ 디렉토리 구조 사용.

### 2. 추가 의존성 설치

```bash
# 런타임 의존성
npm install better-sqlite3 drizzle-orm bcryptjs @tanstack/react-query zod playwright

# 개발 의존성
npm install -D @types/better-sqlite3 @types/bcryptjs drizzle-kit vitest @vitejs/plugin-react
```

| 패키지 | 용도 |
|--------|------|
| `better-sqlite3` | SQLite 드라이버 (동기 API) |
| `drizzle-orm` | 타입 안전 ORM |
| `drizzle-kit` | 마이그레이션 도구 |
| `bcryptjs` | 네이버 API bcrypt 서명 |
| `@tanstack/react-query` | 클라이언트 데이터 페칭/폴링 |
| `zod` | 런타임 데이터 검증 |
| `playwright` | GS택배 브라우저 자동화 |
| `vitest` | 테스트 프레임워크 |

### 3. Playwright 브라우저 설치

```bash
npx playwright install chromium
```

Chromium만 설치 (Firefox, WebKit 불필요). GS택배 사이트는 Chromium 기반 브라우저면 충분.

### 4. shadcn/ui 초기화 + 기본 컴포넌트

```bash
npx shadcn@latest init
```

설정값:
- Style: Default
- Base color: Neutral
- CSS variables: Yes

기본 컴포넌트 설치:
```bash
npx shadcn@latest add button card checkbox badge select table toast dialog
```

### 5. next.config.ts 수정

**After:**
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "playwright"],
};

export default nextConfig;
```

**설명:** better-sqlite3(네이티브 바인딩)과 playwright(브라우저 바이너리)는 webpack 번들링에서 제외해야 정상 동작.

### 6. Drizzle ORM 스키마 정의

**파일:** `src/lib/db/schema.ts`

```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: text("order_id").notNull(),
  productOrderId: text("product_order_id").notNull().unique(),
  orderDate: text("order_date").notNull(),
  productName: text("product_name").notNull(),
  quantity: integer("quantity").notNull().default(1),
  optionInfo: text("option_info"),
  totalPrice: integer("total_price"),
  recipientName: text("recipient_name").notNull(),
  recipientPhone: text("recipient_phone").notNull(),
  recipientAddress: text("recipient_address").notNull(),
  recipientZipCode: text("recipient_zip_code").notNull(),
  status: text("status", {
    enum: ["pending", "booking", "booked", "failed", "skipped"],
  })
    .notNull()
    .default("pending"),
  isNextDayEligible: integer("is_next_day_eligible", { mode: "boolean" })
    .notNull()
    .default(false),
  selectedDeliveryType: text("selected_delivery_type", {
    enum: ["domestic", "nextDay"],
  })
    .notNull()
    .default("domestic"),
  bookingResult: text("booking_result"),
  bookingReservationNo: text("booking_reservation_no"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const bookingLogs = sqliteTable("booking_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").references(() => orders.id),
  action: text("action").notNull(),
  detail: text("detail"),
  screenshotPath: text("screenshot_path"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
```

### 7. DB 연결 싱글턴

**파일:** `src/lib/db/index.ts`

```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "smart-ship.db");

// data 디렉토리 자동 생성
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });
```

**설명:** WAL 모드는 읽기/쓰기 동시성 향상. data 디렉토리 자동 생성으로 첫 실행 시 에러 방지.

### 8. Drizzle 설정 + 마이그레이션

**파일:** `drizzle.config.ts`

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/smart-ship.db",
  },
});
```

마이그레이션 실행:
```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

### 9. QueryClientProvider 설정

**파일:** `src/components/providers.tsx`

```typescript
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
```

### 10. layout.tsx 수정

**After:**
```tsx
import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

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

### 11. 기본 페이지 (대시보드 셸)

**파일:** `src/app/page.tsx`

```tsx
export default function Home() {
  return (
    <main className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Smart Ship Automation</h1>
      <p className="text-muted-foreground">
        네이버 스마트스토어 주문 → GS택배 자동 예약
      </p>
      <div className="mt-8 p-4 border rounded-lg">
        <p className="text-sm text-muted-foreground">
          Phase 2에서 주문 목록이 여기에 표시됩니다.
        </p>
      </div>
    </main>
  );
}
```

### 12. Vitest 설정

**파일:** `vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

### 13. 환경변수 템플릿

**파일:** `.env.local.example`

```bash
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
```

### 14. .gitignore 업데이트

기존 Next.js .gitignore에 추가:
```
# Local DB
data/

# Environment
.env.local

# Playwright
playwright-report/

# Screenshots
data/screenshots/
```

### 15. 공유 타입 정의 (빈 파일)

**파일:** `src/types/index.ts`

```typescript
// 공유 타입은 Phase 2~4에서 추가됨
export {};
```

## 커밋 계획

1. `chore(config): Next.js 15 프로젝트 초기화` - package.json, tsconfig.json, next.config.ts, tailwind.config.ts, postcss.config.mjs, src/app/ 기본 파일
2. `chore(config): 추가 의존성 설치 및 shadcn/ui 초기화` - package.json 업데이트, src/components/ui/
3. `chore(db): Drizzle ORM 스키마 및 마이그레이션` - src/lib/db/, drizzle.config.ts, drizzle/
4. `chore(config): 프로젝트 구조 및 설정 파일 완성` - providers.tsx, vitest.config.ts, .env.local.example, .gitignore, src/types/

## 테스트 계획

- [ ] `npm run dev` 실행 → http://localhost:3000 접속 → 기본 페이지 표시 확인
- [ ] `npx drizzle-kit generate` → 마이그레이션 파일 생성 확인
- [ ] `npx drizzle-kit migrate` → data/smart-ship.db 파일 생성 확인
- [ ] `npx vitest run` → 테스트 실행 가능 확인 (테스트 없어서 패스)
- [ ] `npx tsc --noEmit` → 타입 에러 없음 확인

## 체크리스트

- [ ] `docs/conventions.md` 규칙 준수
- [ ] `.env.local`에 민감 정보 하드코딩 없음
- [ ] 타입 안전성 확인 (any 없음)
- [ ] data/ 디렉토리 .gitignore에 포함

## 프로젝트 히스토리 기록

```markdown
### Phase 1: 프로젝트 셋팅
- **완료일:** YYYY-MM-DD
- **PR:** #N
- **주요 변경:**
  - Next.js 15 + TypeScript + Tailwind CSS + shadcn/ui 초기화
  - SQLite + Drizzle ORM 스키마 (orders, settings, bookingLogs)
  - Playwright, bcryptjs, TanStack Query, Vitest 설정
  - 프로젝트 디렉토리 구조 확립
- **기술적 결정:**
  - serverExternalPackages로 better-sqlite3, playwright 번들링 제외
  - WAL 모드로 SQLite 동시성 향상
  - Playwright는 chromium만 설치 (경량화)
```
