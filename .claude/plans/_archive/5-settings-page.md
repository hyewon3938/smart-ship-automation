# feat(settings): 설정 페이지 - 크리덴셜 및 기본 정보 관리

## 이슈
- 번호: #5
- 브랜치: `feat/5-settings-page`

## 개요
네이버 API 크리덴셜, GS택배 로그인 정보, 보내는 사람 기본 정보, 택배 기본값을 UI에서 관리하는 설정 페이지를 구현한다. 현재 `.env.local`에 하드코딩된 값들을 SQLite DB로 이동하여 앱 재시작 없이 변경 가능하게 한다.

## 설계 결정

### 설정 저장 전략: DB 우선, env 폴백
- 기존 코드(`naver/auth.ts`, `gs-delivery/auth.ts`)는 `process.env`에서 크리덴셜을 읽음
- **변경:** DB에 값이 있으면 DB 우선, 없으면 env 폴백 → 기존 `.env.local` 사용자도 그대로 동작
- 설정 헬퍼 함수 `getConfigValue(key)` 추가: `getSetting(dbKey) ?? process.env[envKey]`

### 비밀번호/시크릿 처리
- DB에는 평문 저장 (로컬 SQLite, 1인 사용)
- API GET 응답 시 비밀번호/시크릿은 마스킹 (`****` + 마지막 4자)
- PUT 요청에서 마스킹된 값이면 기존 값 유지 (업데이트 건너뜀)

### 설정 키 구조
```
naver.clientId, naver.clientSecret
gs.username, gs.password
sender.name, sender.phone, sender.zipcode, sender.address, sender.addressDetail
booking.defaultProductType, booking.defaultPrice, booking.defaultDeliveryType
```

## 변경 파일 목록

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `src/types/index.ts` | 수정 | Settings 관련 타입 추가 |
| `src/lib/settings.ts` | 수정 | 카테고리별 get/set 함수, getConfigValue 헬퍼 |
| `src/app/api/settings/route.ts` | 신규 | GET/PUT /api/settings |
| `src/app/api/settings/test-naver/route.ts` | 신규 | POST 네이버 연결 테스트 |
| `src/app/api/settings/test-gs/route.ts` | 신규 | POST GS택배 로그인 테스트 |
| `src/app/settings/page.tsx` | 신규 | 설정 페이지 (탭 UI) |
| `src/hooks/useSettings.ts` | 신규 | React Query 훅 |
| `src/components/settings/NaverSettingsTab.tsx` | 신규 | 네이버 API 탭 |
| `src/components/settings/GsSettingsTab.tsx` | 신규 | GS택배 탭 |
| `src/components/settings/SenderSettingsTab.tsx` | 신규 | 보내는 사람 탭 |
| `src/components/settings/BookingSettingsTab.tsx` | 신규 | 택배 기본값 탭 |
| `src/lib/naver/auth.ts` | 수정 | DB 설정 우선 읽기 |
| `src/lib/gs-delivery/auth.ts` | 수정 | DB 설정 우선 읽기 |

## 구현 상세

### 1. 타입 정의 (`src/types/index.ts`)

**After:**
```typescript
/** 설정 카테고리별 타입 */
export interface NaverSettings {
  clientId: string;
  clientSecret: string;
}

export interface GsSettings {
  username: string;
  password: string;
}

export interface SenderSettings {
  name: string;
  phone: string;
  zipcode: string;
  address: string;
  addressDetail: string;
}

export interface BookingDefaults {
  defaultProductType: string;   // "08" = 잡화/서적 등
  defaultPrice: string;         // 만원 단위 기본 가격
  defaultDeliveryType: DeliveryType;
}

export interface AllSettings {
  naver: NaverSettings;
  gs: GsSettings;
  sender: SenderSettings;
  booking: BookingDefaults;
}
```

### 2. 설정 서비스 확장 (`src/lib/settings.ts`)

**Before:**
```typescript
export function getSetting(key: string): string | null { ... }
export function setSetting(key: string, value: string): void { ... }
```

**After:**
```typescript
import type { AllSettings, NaverSettings, GsSettings, SenderSettings, BookingDefaults } from "@/types";

// 기존 getSetting, setSetting 유지

/** DB → env 폴백 설정 읽기 */
export function getConfigValue(dbKey: string, envKey: string): string | null {
  return getSetting(dbKey) ?? process.env[envKey] ?? null;
}

/** 비밀값 마스킹 (마지막 4자만 표시) */
function maskSecret(value: string | null): string {
  if (!value || value.length <= 4) return value ? "****" : "";
  return "****" + value.slice(-4);
}

/** 전체 설정 조회 (비밀값 마스킹) */
export function getAllSettings(): AllSettings {
  return {
    naver: {
      clientId: getConfigValue("naver.clientId", "NAVER_CLIENT_ID") ?? "",
      clientSecret: maskSecret(getConfigValue("naver.clientSecret", "NAVER_CLIENT_SECRET")),
    },
    gs: {
      username: getConfigValue("gs.username", "GS_USERNAME") ?? "",
      password: maskSecret(getConfigValue("gs.password", "GS_PASSWORD")),
    },
    sender: {
      name: getConfigValue("sender.name", "SENDER_NAME") ?? "",
      phone: getConfigValue("sender.phone", "SENDER_PHONE") ?? "",
      zipcode: getConfigValue("sender.zipcode", "SENDER_ZIPCODE") ?? "",
      address: getConfigValue("sender.address", "SENDER_ADDRESS") ?? "",
      addressDetail: getConfigValue("sender.addressDetail", "SENDER_ADDRESS_DETAIL") ?? "",
    },
    booking: {
      defaultProductType: getSetting("booking.defaultProductType") ?? "08",
      defaultPrice: getSetting("booking.defaultPrice") ?? "1",
      defaultDeliveryType: (getSetting("booking.defaultDeliveryType") as "domestic" | "nextDay") ?? "domestic",
    },
  };
}

/** 전체 설정 조회 (비밀값 포함, 내부용) */
export function getAllSettingsRaw(): AllSettings {
  return {
    naver: {
      clientId: getConfigValue("naver.clientId", "NAVER_CLIENT_ID") ?? "",
      clientSecret: getConfigValue("naver.clientSecret", "NAVER_CLIENT_SECRET") ?? "",
    },
    gs: {
      username: getConfigValue("gs.username", "GS_USERNAME") ?? "",
      password: getConfigValue("gs.password", "GS_PASSWORD") ?? "",
    },
    sender: {
      name: getConfigValue("sender.name", "SENDER_NAME") ?? "",
      phone: getConfigValue("sender.phone", "SENDER_PHONE") ?? "",
      zipcode: getConfigValue("sender.zipcode", "SENDER_ZIPCODE") ?? "",
      address: getConfigValue("sender.address", "SENDER_ADDRESS") ?? "",
      addressDetail: getConfigValue("sender.addressDetail", "SENDER_ADDRESS_DETAIL") ?? "",
    },
    booking: {
      defaultProductType: getSetting("booking.defaultProductType") ?? "08",
      defaultPrice: getSetting("booking.defaultPrice") ?? "1",
      defaultDeliveryType: (getSetting("booking.defaultDeliveryType") as "domestic" | "nextDay") ?? "domestic",
    },
  };
}

/** 카테고리별 설정 업데이트. 마스킹 값("****")이면 건너뜀 */
export function updateNaverSettings(data: NaverSettings): void {
  if (data.clientId) setSetting("naver.clientId", data.clientId);
  if (data.clientSecret && !data.clientSecret.startsWith("****")) {
    setSetting("naver.clientSecret", data.clientSecret);
  }
}

export function updateGsSettings(data: GsSettings): void {
  if (data.username) setSetting("gs.username", data.username);
  if (data.password && !data.password.startsWith("****")) {
    setSetting("gs.password", data.password);
  }
}

export function updateSenderSettings(data: SenderSettings): void {
  setSetting("sender.name", data.name);
  setSetting("sender.phone", data.phone);
  setSetting("sender.zipcode", data.zipcode);
  setSetting("sender.address", data.address);
  setSetting("sender.addressDetail", data.addressDetail);
}

export function updateBookingDefaults(data: BookingDefaults): void {
  setSetting("booking.defaultProductType", data.defaultProductType);
  setSetting("booking.defaultPrice", data.defaultPrice);
  setSetting("booking.defaultDeliveryType", data.defaultDeliveryType);
}
```

**설명:** 마스킹 로직으로 비밀값이 API 응답에 노출되지 않도록 하며, PUT에서 "****"로 시작하면 기존 값을 유지한다.

### 3. API 라우트: GET/PUT /api/settings (`src/app/api/settings/route.ts`)

```typescript
import { NextRequest, NextResponse } from "next/server";
import {
  getAllSettings,
  updateNaverSettings,
  updateGsSettings,
  updateSenderSettings,
  updateBookingDefaults,
} from "@/lib/settings";
import type { AllSettings } from "@/types";

export async function GET() {
  try {
    const settings = getAllSettings(); // 마스킹된 버전
    return NextResponse.json(settings);
  } catch (error) {
    console.error("설정 조회 실패:", error);
    return NextResponse.json({ error: "설정을 조회할 수 없습니다." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body: Partial<AllSettings> = await request.json();

    if (body.naver) updateNaverSettings(body.naver);
    if (body.gs) updateGsSettings(body.gs);
    if (body.sender) updateSenderSettings(body.sender);
    if (body.booking) updateBookingDefaults(body.booking);

    const updated = getAllSettings();
    return NextResponse.json(updated);
  } catch (error) {
    console.error("설정 저장 실패:", error);
    return NextResponse.json({ error: "설정을 저장할 수 없습니다." }, { status: 500 });
  }
}
```

### 4. API 라우트: POST /api/settings/test-naver (`src/app/api/settings/test-naver/route.ts`)

```typescript
import { NextResponse } from "next/server";
import { getAccessToken, _resetTokenCache } from "@/lib/naver/auth";

export async function POST() {
  try {
    // 토큰 캐시 리셋 후 새로 발급 시도
    _resetTokenCache();
    const token = await getAccessToken();
    return NextResponse.json({
      success: true,
      message: "네이버 API 연결 성공",
      tokenPreview: token.slice(0, 8) + "...",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ success: false, message: msg }, { status: 400 });
  }
}
```

**설명:** `_resetTokenCache()`로 캐시를 초기화하고 실제 토큰 발급을 시도. 성공하면 토큰 앞 8자만 미리보기로 반환.

### 5. API 라우트: POST /api/settings/test-gs (`src/app/api/settings/test-gs/route.ts`)

```typescript
import { NextResponse } from "next/server";
import { newPage, closeBrowser } from "@/lib/gs-delivery/browser";
import { login } from "@/lib/gs-delivery/auth";

export async function POST() {
  let page;
  try {
    page = await newPage();
    await login(page);
    return NextResponse.json({
      success: true,
      message: "GS택배 로그인 성공",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ success: false, message: msg }, { status: 400 });
  } finally {
    await page?.close().catch(() => {});
  }
}
```

**설명:** Playwright headed 브라우저를 열어 실제 로그인 시도. Turnstile 캡챠가 있으므로 브라우저 창에서 사용자가 캡챠를 통과해야 할 수 있음 — 이 점을 UI에서 안내.

### 6. 네이버 auth.ts 수정 (`src/lib/naver/auth.ts`)

**Before:**
```typescript
const clientId = process.env.NAVER_CLIENT_ID;
const clientSecret =
  readRawEnv("NAVER_CLIENT_SECRET") ?? process.env.NAVER_CLIENT_SECRET;
```

**After:**
```typescript
import { getConfigValue } from "@/lib/settings";

const clientId = getConfigValue("naver.clientId", "NAVER_CLIENT_ID");
// clientSecret은 bcrypt salt($) 포함이므로 DB값 우선, 없으면 raw env 읽기
const dbSecret = getSetting("naver.clientSecret");
const clientSecret = dbSecret ?? readRawEnv("NAVER_CLIENT_SECRET") ?? process.env.NAVER_CLIENT_SECRET;
```

**설명:** DB에 설정된 값이 있으면 우선 사용. DB가 비어있으면 기존 `.env.local` 폴백. clientSecret은 bcrypt salt 특수 처리 유지.

### 7. GS택배 auth.ts 수정 (`src/lib/gs-delivery/auth.ts`)

**Before:**
```typescript
const username = process.env.GS_USERNAME;
const password = process.env.GS_PASSWORD;
```

**After:**
```typescript
import { getConfigValue } from "@/lib/settings";

const username = getConfigValue("gs.username", "GS_USERNAME");
const password = getConfigValue("gs.password", "GS_PASSWORD");
```

### 8. React Query 훅 (`src/hooks/useSettings.ts`)

```typescript
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AllSettings } from "@/types";

export function useSettings() {
  return useQuery<AllSettings>({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("설정 조회 실패");
      return res.json();
    },
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation<AllSettings, Error, Partial<AllSettings>>({
    mutationFn: async (data) => {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "설정 저장 실패");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useTestNaver() {
  return useMutation<{ success: boolean; message: string }>({
    mutationFn: async () => {
      const res = await fetch("/api/settings/test-naver", { method: "POST" });
      return res.json();
    },
  });
}

export function useTestGs() {
  return useMutation<{ success: boolean; message: string }>({
    mutationFn: async () => {
      const res = await fetch("/api/settings/test-gs", { method: "POST" });
      return res.json();
    },
  });
}
```

### 9. 설정 페이지 UI (`src/app/settings/page.tsx`)

- 상단: "설정" 제목 + 대시보드로 돌아가기 링크
- 4개 탭: 네이버 API / GS택배 / 보내는 사람 / 택배 기본값
- 탭 전환은 `useState` (URL 기반 필요 없음 — 단일 페이지)
- 각 탭은 별도 컴포넌트로 분리

**레이아웃:**
```
┌─────────────────────────────────────────┐
│ ← 대시보드  |  설정                      │
├─────────────────────────────────────────┤
│ [네이버 API] [GS택배] [보내는 사람] [택배 기본값] │
├─────────────────────────────────────────┤
│                                         │
│  client_id:     [__________________]    │
│  client_secret: [__________________]    │
│                                         │
│  [연결 테스트]          [저장]           │
│                                         │
└─────────────────────────────────────────┘
```

### 10. 탭 컴포넌트 상세

#### NaverSettingsTab
- `client_id` 텍스트 입력
- `client_secret` 패스워드 입력 (마스킹)
- "연결 테스트" 버튼 → `useTestNaver()` → 성공/실패 토스트
- "저장" 버튼 → `useUpdateSettings({ naver: {...} })`

#### GsSettingsTab
- `username` 텍스트 입력
- `password` 패스워드 입력 (마스킹)
- "로그인 테스트" 버튼 → `useTestGs()` → 성공/실패 토스트
- 안내 텍스트: "로그인 테스트 시 브라우저 창이 열립니다. 캡챠가 표시되면 직접 통과해주세요."
- "저장" 버튼

#### SenderSettingsTab
- 이름, 전화번호, 우편번호, 주소, 상세주소 텍스트 입력
- "저장" 버튼

#### BookingSettingsTab
- 기본 물품유형: `<select>` (08=잡화/서적, 01=의류, 02=식품, ...)
- 기본 가격: 숫자 입력 (만원 단위)
- 기본 택배유형: `<select>` (국내택배/내일배송)
- "저장" 버튼

### 11. 네비게이션

대시보드(`Dashboard.tsx`)에 설정 페이지로의 링크 추가:
```typescript
// 헤더 영역에 설정 아이콘/링크 추가
<Link href="/settings" className="text-muted-foreground hover:text-foreground">
  설정
</Link>
```

### 12. shadcn/ui 컴포넌트 추가

필요한 새 컴포넌트:
- `input` — 텍스트/패스워드 입력
- `label` — 폼 라벨
- `tabs` — 탭 전환 UI
- `card` — 탭 컨텐츠 래퍼

```bash
npx shadcn@latest add input label tabs card
```

## 커밋 계획

1. `feat(settings): 설정 타입 및 서비스 함수 확장` — `types/index.ts`, `lib/settings.ts`
2. `feat(settings): 설정 API 라우트 (GET/PUT, 연결 테스트)` — `api/settings/` 전체
3. `feat(settings): 기존 auth 모듈 DB 설정 우선 읽기 적용` — `naver/auth.ts`, `gs-delivery/auth.ts`
4. `feat(ui): 설정 페이지 UI 및 React Query 훅` — `settings/page.tsx`, 컴포넌트, 훅, 네비게이션

## 테스트 계획

- [ ] `lib/settings.ts` 단위 테스트: `getConfigValue` 폴백 동작, 마스킹 로직, 카테고리별 업데이트
- [ ] GET /api/settings → 마스킹된 값 반환 확인
- [ ] PUT /api/settings → 마스킹 값 유지, 새 값 업데이트 확인
- [ ] 네이버 연결 테스트 → 성공/실패 응답 확인 (수동)
- [ ] GS택배 로그인 테스트 → 브라우저 열림 확인 (수동)
- [ ] 설정 페이지 UI 동작 확인 (수동)

## 체크리스트

- [ ] 프로젝트 컨벤션 규칙 준수 (네이밍, import 정렬, 레이어 분리)
- [ ] 민감 정보 하드코딩 없음
- [ ] 타입 안전성 확인 (zod 없이 가능 — 내부 DB 데이터)
- [ ] 에러 핸들링 포함 (API 라우트 try/catch, mutation onError 토스트)
- [ ] 비밀값 마스킹 처리
- [ ] `docs/project-history.md`에 Phase 5 기록

## project-history.md 기록 내용

```markdown
### Phase 5: 설정 페이지 (#5)
- 설정 페이지 UI (탭 구조: 네이버 API / GS택배 / 보내는 사람 / 택배 기본값)
- 설정 CRUD API (`/api/settings` GET/PUT)
- 네이버 API 연결 테스트 / GS택배 로그인 테스트 엔드포인트
- DB 설정 우선, env 폴백 전략으로 기존 `.env.local` 호환 유지
- 비밀값 마스킹 처리
```
