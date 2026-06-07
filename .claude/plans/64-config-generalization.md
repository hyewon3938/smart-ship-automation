# refactor(config): 개인 환경 하드코딩 설정화 — fork 가능하게 일반화

## 이슈
- 번호: #64
- 브랜치: `refactor/64-config-generalization`
- ADR: docs/adr/0002-sender-via-addressbook-name.md (신규)

## 개요

GitHub star를 계기로, 제3자가 fork해서 **자기 스마트스토어 / GS택배 계정 / 발송인**으로
바로 쓸 수 있도록 "리커밋" 개인 환경에 묶인 하드코딩 값을 설정화한다.

핵심은 **새 설정 인프라 구축이 아니라 "고아 설정 연결"**이다. 이 프로젝트는 이미
`settings` DB 테이블 + `getConfigValue(dbKey, envKey)` (DB 우선 → env 폴백) + 설정 탭
구조를 갖추고 있는데, 일부 값이 설정 UI에는 있으나 자동화 코드가 안 읽거나(발송인·품목),
UI에 렌더링조차 안 되는(SenderSettingsTab) 상태다.

## 핵심 결정 (인터뷰 결과)

1. **발송인 = 주소록 이름 매칭** (ADR-0002): GS택배는 발송인을 폼 직접입력이 아니라
   "나의 주소록"에서 이름으로 찾아 선택하는 구조. 따라서 설정은 **"주소록 발송인 이름"
   단일 값**으로 충분. 기존 SenderSettings의 전화/주소/우편번호 필드는 자동화가 안 쓰는
   고아 → 제거.
2. **저장 위치 = 기존 패턴 유지**: `getConfigValue(dbKey, envKey)` (DB UI 우선 + env 폴백).
3. **품목코드 = 설정 연결 + 동적화**: `booking.defaultProductType`을 자동화가 읽고,
   동의 체크박스 셀렉터를 `#exemption_agree{code}`로 동적 생성.
4. **기본값 정책 = 중립값 + env 폴백으로 본인 무변화**: 코드 최종 폴백은 중립/빈값으로
   두되, 본인 `.env.local`에 `SENDER_NAME=리커밋` 등을 두면 env 폴백으로 기존과 동일 동작.
   → 안전원칙(본인 무변화)과 일반화(오픈소스에 개인이름 미노출)를 동시 충족.
5. **발송인 이름 탭 위치 = GS택배 탭에 통합**: GS 주소록은 GS 계정 소속이므로
   `GsSettingsTab`(아이디/비번)에 "주소록 발송인 이름" 필드 추가. 죽어있던 별도 Sender 탭은
   부활시키지 않고 제거.

## 변경 파일 목록

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `src/types/index.ts` | 수정 | `SenderSettings` 제거, `GsSettings`에 `senderName` 추가, `BookingDefaults`에 `visitReservationName` 추가 |
| `src/lib/settings.ts` | 수정 | sender 블록 제거 → gs.senderName 통합, visitReservationName 추가, 헬퍼 `getSenderAddressBookName()` / `getVisitReservationName()` / `getProductTypeCode()` 신설, `updateSenderSettings` 제거 |
| `src/app/api/settings/route.ts` | 수정 | `updateSenderSettings` import/호출 제거 |
| `src/components/settings/GsSettingsTab.tsx` | 수정 | "주소록 발송인 이름" 입력 필드 추가 |
| `src/components/settings/BookingSettingsTab.tsx` | 수정 | "방문택배 예약명" 입력 필드 추가 |
| `src/components/settings/SenderSettingsTab.tsx` | **삭제** | 죽은 코드 (UI 미렌더 + 자동화 미사용) |
| `src/lib/gs-delivery/automation.ts` | 수정 | "리커밋" → `getSenderAddressBookName()`, `selectOption("08")` + `#exemption_agree08` → 설정값 기반 동적화 |
| `src/lib/gs-delivery/visit-pickup.ts` | 수정 | "리커밋" → 설정값, "리뷰어 발송" → `getVisitReservationName()`, 품목코드 동적화 |
| `src/components/VisitPickupConfirmDialog.tsx` | 수정 | 하드코딩 안내문 "예약명: 리뷰어 발송 / 보내는 분: 리커밋" → 설정값 표시 (useSettings) |
| `ecosystem.config.cjs` | 수정 | `/home/ubuntu/...` 절대경로 → `__dirname` 기반 동적 경로 |
| `.env.local.example` | 수정 | `SENDER_PHONE/ZIPCODE/ADDRESS` 제거, `VISIT_RESERVATION_NAME` 추가, `SENDER_NAME` 설명 갱신 |
| `README.md` | 수정 | 환경변수 표 갱신 + "GS 주소록 발송인 등록" 안내 추가 |
| `docs/images/architecture.svg` | 수정 | `ship.leecommit.kr` → `ship.example.com` |
| `docs/adr/0002-sender-via-addressbook-name.md` | 신규 | ADR 작성 |
| `src/lib/dispatch-window.ts` | 신규 | 스크래핑 윈도우 상수/함수 분리 (클라이언트·서버 공유) |
| `src/lib/dispatch-worker.ts` | 수정 | 윈도우 상수/함수를 dispatch-window.ts에서 import (중복 제거) |
| `src/components/settings/DispatchSettingsTab.tsx` | 수정 | 자동발송 동작 시간대 안내 문구 추가 |

총 17개 (신규 2 + 삭제 1 + 수정 14).

## 구현 상세

### 1. 타입 정리 (`src/types/index.ts`)

**Before:**
```typescript
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
  defaultProductType: string;
  defaultPrice: string;
  defaultDeliveryType: DeliveryType;
}

export interface AllSettings {
  naver: NaverSettings;
  gs: GsSettings;
  sender: SenderSettings;
  booking: BookingDefaults;
  dispatch: DispatchSettings;
}
```

**After:**
```typescript
export interface GsSettings {
  username: string;
  password: string;
  /** GS택배 "나의 주소록"에 등록한 발송인 이름 (예약 시 이 이름으로 주소록 항목 선택) */
  senderName: string;
}

// SenderSettings 제거

export interface BookingDefaults {
  defaultProductType: string;
  defaultPrice: string;
  defaultDeliveryType: DeliveryType;
  /** 방문택배 예약명 (GS 예약 목록 식별용) */
  visitReservationName: string;
}

export interface AllSettings {
  naver: NaverSettings;
  gs: GsSettings;
  booking: BookingDefaults;
  dispatch: DispatchSettings;
}
```

### 2. 설정 로직 (`src/lib/settings.ts`)

**핵심 변경:**
- `getAllSettings`/`getAllSettingsRaw`에서 `sender` 블록 제거, `gs.senderName` 추가, `booking.visitReservationName` 추가
- `updateSenderSettings` 제거, `updateGsSettings`에 senderName 저장 추가, `updateBookingDefaults`에 visitReservationName 추가
- 신규 헬퍼 3개

**After (gs 블록):**
```typescript
gs: {
  username: getConfigValue("gs.username", "GS_USERNAME") ?? "",
  password: maskSecret(getConfigValue("gs.password", "GS_PASSWORD")),
  // env 폴백은 기존 SENDER_NAME 재활용 (본인 .env.local에 이미 있을 수 있음 → 무변화)
  senderName: getConfigValue("gs.senderName", "SENDER_NAME") ?? "",
},
```

**After (booking 블록):**
```typescript
booking: {
  defaultProductType: getSetting("booking.defaultProductType") ?? "08",
  defaultPrice: getSetting("booking.defaultPrice") ?? "1",
  defaultDeliveryType:
    (getSetting("booking.defaultDeliveryType") as "domestic" | "nextDay") ?? "domestic",
  // 중립 기본값. 본인은 env VISIT_RESERVATION_NAME 또는 설정으로 "리뷰어 발송" 지정
  visitReservationName:
    getConfigValue("booking.visitReservationName", "VISIT_RESERVATION_NAME") ?? "방문택배 발송",
},
```

**신규 헬퍼:**
```typescript
/** GS 주소록에서 선택할 발송인 이름 조회. 미설정이면 빈 문자열 → 호출부에서 에러 처리 */
export function getSenderAddressBookName(): string {
  return getConfigValue("gs.senderName", "SENDER_NAME") ?? "";
}

/** 방문택배 예약명 조회 */
export function getVisitReservationName(): string {
  return getConfigValue("booking.visitReservationName", "VISIT_RESERVATION_NAME") ?? "방문택배 발송";
}

/** 예약 품목 유형 코드 조회 (기본 08 잡화/서적) */
export function getProductTypeCode(): string {
  return getSetting("booking.defaultProductType") ?? "08";
}
```

`updateGsSettings` / `updateBookingDefaults`에 신규 필드 저장 추가:
```typescript
export function updateGsSettings(data: GsSettings): void {
  if (data.username) setSetting("gs.username", data.username);
  if (data.password && !data.password.startsWith("****")) {
    setSetting("gs.password", data.password);
  }
  setSetting("gs.senderName", data.senderName);  // ← 추가
}

export function updateBookingDefaults(data: BookingDefaults): void {
  setSetting("booking.defaultProductType", data.defaultProductType);
  setSetting("booking.defaultPrice", data.defaultPrice);
  setSetting("booking.defaultDeliveryType", data.defaultDeliveryType);
  setSetting("booking.visitReservationName", data.visitReservationName);  // ← 추가
}
```

> 기존 DB에 남아있는 `sender.*` 행은 더 이상 읽지 않으므로 무해. 정리(DELETE)는 선택사항 — 별도 마이그레이션 없이 방치해도 동작에 영향 없음.

### 3. 발송인 주소록 이름 (`automation.ts` / `visit-pickup.ts`)

**Before (automation.ts, ~15곳에서 "리커밋" 하드코딩):**
```typescript
// 주소록 레이어에서 "리커밋" 또는 "기본" 뱃지 항목 선택
const addrSelected = await page.evaluate(() => {
  for (const row of Array.from(rows)) {
    if (row.textContent?.includes("리커밋")) { ... }
  }
  ...
});
// 검증
if (!senderName.includes("리커밋")) { ... }
```

**After (설정값 1회 조회 후 evaluate에 주입):**
```typescript
import { getSenderAddressBookName } from "@/lib/settings";

// fillAndSubmitForm 시작부에서 1회 조회
const senderAddrName = getSenderAddressBookName();
if (!senderAddrName) {
  throw new Error(
    "발송인 이름이 설정되지 않았습니다. 설정 > GS택배 > '주소록 발송인 이름'을 입력하세요."
  );
}

// evaluate에 인자로 주입
const addrSelected = await page.evaluate((targetName) => {
  for (const row of Array.from(rows)) {
    if (row.textContent?.includes(targetName)) { ... }
  }
  ...
}, senderAddrName);

if (!senderName.includes(senderAddrName)) { ... }  // 검증도 설정값으로
```

**설명:**
- `page.evaluate`는 브라우저 컨텍스트라 클로저로 외부 변수 접근 불가 → **반드시 인자로 주입**
- 빈 값이면 즉시 명확한 에러 (현재의 "첫 항목 fallback"은 엉뚱한 발송인 선택 위험이 있어, 미설정 시엔 진행하지 않고 에러가 안전)
- visit-pickup.ts의 `selectSenderFromAddressBook`도 동일 패턴. 함수 시그니처에 `senderName: string` 파라미터 추가하여 주입

### 4. 방문택배 예약명 (`visit-pickup.ts`)

**Before:**
```typescript
// 예약명: "리뷰어 발송" (고정)
await page.locator(S.RESERVATION_NAME).fill("리뷰어 발송");
```

**After:**
```typescript
import { getVisitReservationName } from "@/lib/settings";

const reservationName = getVisitReservationName();
await page.locator(S.RESERVATION_NAME).fill(reservationName);
```

### 5. 품목코드 동적화 (`automation.ts` / `visit-pickup.ts`)

**Before:**
```typescript
// 2-1. 품목선택: value "08"
await page.locator(S.PRODUCT_SELECT).selectOption("08");
// 2-2. 동의 체크박스: #exemption_agree08
await page.evaluate(() => {
  const cb = document.querySelector("#exemption_agree08") as HTMLInputElement | null;
  if (cb && !cb.checked) {
    const label = document.querySelector("label[for='exemption_agree08']") as HTMLElement | null;
    ...
  }
});
```

**After (품목코드를 인자로 주입, 셀렉터 동적 생성):**
```typescript
import { getProductTypeCode } from "@/lib/settings";

const productCode = getProductTypeCode();  // "08" 등
await page.locator(S.PRODUCT_SELECT).selectOption(productCode);

await page.evaluate((code) => {
  const cb = document.querySelector(`#exemption_agree${code}`) as HTMLInputElement | null;
  if (cb && !cb.checked) {
    const label = document.querySelector(`label[for='exemption_agree${code}']`) as HTMLElement | null;
    if (label) label.click();
    else { cb.checked = true; cb.dispatchEvent(new Event("change", { bubbles: true })); }
  }
  const hidden = document.querySelector("#exemption_agree") as HTMLInputElement | null;
  if (hidden) hidden.value = "Y";
}, productCode);
```

**주의:**
- 품목마다 동의 체크박스 패널 존재 여부·ID 패턴이 다를 수 있음 (GS 사이트가 품목별로 다른 동의 UI를 보여줄 가능성). 못 찾으면 기존처럼 hidden `exemption_agree=Y`만 설정하고 진행하는 fallback 유지
- **기본값 "08" 유지 → 본인 환경(잡화/서적)은 동작 무변화**. 다른 품목은 본인이 실제 예약 1건으로 검증 후 사용

### 6. 방문택배 확인 다이얼로그 (`VisitPickupConfirmDialog.tsx`)

**Before:**
```tsx
<p>- 예약명: 리뷰어 발송 / 보내는 분: 리커밋</p>
```

**After (설정값 표시):**
```tsx
import { useSettings } from "@/hooks/useSettings";

const { data: settings } = useSettings();
const reservationName = settings?.booking.visitReservationName ?? "방문택배 발송";
const senderName = settings?.gs.senderName || "(미설정 — 설정에서 입력 필요)";
...
<p>- 예약명: {reservationName} / 보내는 분: {senderName}</p>
```

### 7. 배포 경로 (`ecosystem.config.cjs`)

**Before:**
```javascript
cwd: "/home/ubuntu/smart-ship-automation",
env: {
  ...
  SMART_SHIP_DB_PATH: "/home/ubuntu/smart-ship-automation/data/smart-ship.db",
},
```

**After:**
```javascript
const path = require("path");
// ...
cwd: __dirname,
env: {
  ...
  // Next.js standalone의 process.chdir 대응 — 절대경로 필요하나 clone 위치 무관하게 동적 생성
  SMART_SHIP_DB_PATH: path.join(__dirname, "data", "smart-ship.db"),
},
```

**설명:** `__dirname`은 ecosystem.config.cjs가 위치한 프로젝트 루트 → 어느 경로에 clone하든 동작. DB 경로가 절대경로여야 하는 이유(standalone chdir 이슈)는 그대로 충족.

### 8. README + 문서

**환경변수 표 (README.md):**
```diff
- | `SENDER_NAME` | 보내는 사람 이름 |
- | `SENDER_PHONE` | 보내는 사람 전화번호 |
- | `SENDER_ZIPCODE` | 보내는 사람 우편번호 |
- | `SENDER_ADDRESS` | 보내는 사람 주소 |
+ | `SENDER_NAME` | **GS택배 "나의 주소록"에 등록한 발송인 이름** (예약 시 이 이름으로 주소록 항목 선택) |
+ | `VISIT_RESERVATION_NAME` | 방문택배 예약명 (선택, 기본 "방문택배 발송") |
```

**첫 사용 순서에 안내 추가 (사용자 요구사항):**
```diff
  ### 첫 사용 순서

+ 0. **GS택배 주소록 등록** (최초 1회): GS택배(cvsnet.co.kr) 로그인 → 마이페이지 → 나의 주소록에
+    발송인(보내는 분) 정보를 등록하고, 그 **이름**을 설정의 "주소록 발송인 이름"에 입력합니다.
+    (앱은 예약 시 주소록에서 이 이름으로 발송인을 자동 선택합니다)
  1. **설정 페이지** → 네이버 API 키, GS택배 계정(아이디·비번·주소록 발송인 이름) 입력
  2. **동기화** 버튼 → 네이버 발송대기 주문 가져오기
  ...
```

**주요 기능 표 문구(line 33) 수정:**
```diff
- | **설정 페이지** | 네이버 API 키 / GS택배 계정 / 보내는 사람 정보 UI 관리 |
+ | **설정 페이지** | 네이버 API 키 / GS택배 계정 / 택배 기본값 UI 관리 |
```

**architecture.svg:** `ship.leecommit.kr` → `ship.example.com`

### 9. 자동발송 동작 안내 + 윈도우 상수 분리

**배경:** 자동발송 on/off 토글(`dispatch.autoMode`)은 이미 `DispatchSettingsTab` + `dispatch-worker.ts`에 완성·동작 중. 스크래핑 윈도우(`SCRAPE_START_HOUR=8`, `SCRAPE_END_HOUR=18`)도 하드코딩 상수로 존재. **기능 추가가 아니라 "사용자에게 동작 시간대·on/off를 안내"하는 것이 목적.** 윈도우 시각 자체의 설정화는 범위 외(사용자 확정).

**9-1. 윈도우 상수 분리 (`src/lib/dispatch-window.ts` 신규):**

`dispatch-worker.ts`는 better-sqlite3 등 서버 전용 모듈을 import하므로 클라이언트(설정 탭)에서 직접 import 불가. 윈도우 상수/함수만 순수 모듈로 분리해 양쪽에서 공유.

```typescript
// src/lib/dispatch-window.ts (신규 — 순수 상수/함수, 클라이언트 안전)

/** 운송장 스크래핑 허용 시간대 (KST). 상세 의도는 dispatch-worker 주석 참조 */
export const SCRAPE_START_HOUR = 8;  // 오전 8시
export const SCRAPE_END_HOUR = 18;   // 오후 6시

/** 현재 시간이 스크래핑 허용 시간대인지 확인 */
export function isWithinScrapeWindow(): boolean {
  const now = new Date();
  const kstHour = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }),
  ).getHours();
  return kstHour >= SCRAPE_START_HOUR && kstHour < SCRAPE_END_HOUR;
}
```

`dispatch-worker.ts`: 로컬 정의(37-38, 81-87) 제거 → `import { SCRAPE_START_HOUR, SCRAPE_END_HOUR, isWithinScrapeWindow } from "@/lib/dispatch-window"`. 윈도우 설계 의도 주석(26-36)은 dispatch-window.ts로 이동.

**9-2. 설정 탭 안내 (`DispatchSettingsTab.tsx`):**

"자동 발송처리" Switch 아래 설명에 동작 시간대 추가 (상수 import해 동적 표시):

```tsx
import { SCRAPE_START_HOUR, SCRAPE_END_HOUR } from "@/lib/dispatch-window";

<p className="text-xs text-muted-foreground">
  운송장번호 감지 시 즉시 네이버 발송처리 (OFF = 수동 승인)
</p>
<p className="text-xs text-muted-foreground">
  예약 후 매일 오전 {SCRAPE_START_HOUR}시~오후 {SCRAPE_END_HOUR - 12}시(KST)에 운송장을 확인하고 발송처리합니다.
</p>
```

**9-3. README 자동발송 안내:** "## 자동 발송처리" 섹션 신설 (또는 기능 표 인접) — 동작 시간대 + on/off 위치 안내.

```markdown
## 자동 발송처리

예약이 완료되면 서버가 운송장번호를 자동으로 확인해 네이버에 발송처리합니다.

- **동작 시간대**: 매일 오전 8시 ~ 오후 6시 (KST). 이 시간대에 GS택배 예약조회에서 운송장번호를 폴링합니다.
- **켜기/끄기**: 설정 → 발송처리 탭 → "자동 발송처리" 토글. OFF 시 운송장번호만 수집하고 발송처리는 수동 승인합니다.
```

## ADR 작성

**대상 여부**: **YES** — adr-criteria 5조건 중 4개 충족
- ✅ 되돌리기 어렵다: 타입·설정 스키마·UI 동시 변경
- ✅ 대안이 있었다: 주소록 이름 매칭 vs 폼 직접입력 vs 전체 필드 유지
- ✅ 장기 영향: 발송인 설정 구조 (모든 fork 사용자가 의존)
- ✅ 비자명: "왜 발송인 전화/주소를 설정 안 하나?" → GS가 주소록 선택 UI라는 게 코드만 봐선 안 보임

**번호**: 0002

**초안** (`docs/adr/0002-sender-via-addressbook-name.md`):
- **Context**: GS택배는 발송인을 폼 직접입력이 아니라 "나의 주소록"에서 선택. 자동화는 주소록
  레이어에서 이름 텍스트 매칭으로 항목을 클릭. 발송인 상세정보(전화/주소/우편번호)는 주소록
  항목에 이미 저장돼 있어 폼에 따로 입력할 필요 없음. 기존 코드는 발송인 이름을 "리커밋"으로
  하드코딩 + SenderSettings에 미사용 필드(전화/주소) 보유.
- **Decision**: 발송인 설정을 **"주소록 발송인 이름" 단일 값**으로 통일. GsSettings에 통합
  (`gs.senderName`, env 폴백 `SENDER_NAME`). 자동화는 이 값으로 주소록 항목 매칭. 미설정 시
  명확한 에러. 미사용 SenderSettings(전화/주소/우편번호) 및 죽은 SenderSettingsTab 제거.
- **Alternatives**:
  - **폼 직접입력 자동화**: 주소록 미등록으로도 동작하지만 GS 폼 재분석 필요 + 주소록 선택이
    GS 권장 UX. ROI 낮음.
  - **전체 SenderSettings 유지**: 미사용 필드가 "입력하면 동작할 것 같은" 혼란 유발 (고아 설정).
- **Consequences**:
  - (+) 설정 단순, UI=실제동작 일치, fork 사용자는 주소록 1회 등록 + 이름 입력만
  - (−) 발송인 변경 시 GS 주소록 + 설정 양쪽 수정 필요
  - (−) 주소록에 동명이인 있으면 첫 매칭 항목 선택 (현 로직 동일, 실사용 문제 없음)

## 커밋 계획

1. `refactor(config): 발송인을 주소록 이름 단일 설정으로 통합` — types, settings.ts, GsSettingsTab, SenderSettingsTab 삭제, api/settings/route, automation.ts/visit-pickup.ts 발송인 부분, VisitPickupConfirmDialog, ADR-0002
2. `refactor(config): 방문택배 예약명 + 품목코드 설정 연결` — types, settings.ts, BookingSettingsTab, visit-pickup.ts 예약명, automation.ts/visit-pickup.ts 품목코드
3. `feat(settings): 자동발송 동작 시간대 안내 + 윈도우 상수 분리` — dispatch-window.ts(신규), dispatch-worker.ts, DispatchSettingsTab.tsx
4. `chore(deploy): ecosystem 경로 __dirname 기반으로 일반화` — ecosystem.config.cjs
5. `docs: fork 사용자용 환경변수·셋업·자동발송 안내 일반화` — README.md(+자동발송 섹션), .env.local.example, architecture.svg

## 테스트 계획

- [ ] `npm run build` 타입 통과 (SenderSettings 제거 후 참조 누락 없는지 — 컴파일러가 검출)
- [ ] 기존 단위 테스트 통과 (`settings.test.ts` 등 — SenderSettings 관련 테스트 있으면 갱신)
- [ ] 설정 페이지 수동 확인: GS택배 탭에 "주소록 발송인 이름" 필드, 택배 기본값 탭에 "방문택배 예약명" 필드 표시·저장
- [ ] **회귀 (본인 환경)**: `.env.local`에 `SENDER_NAME=리커밋` 설정 후 국내택배 예약 1건 — 발송인 "리커밋" 정상 선택 확인 (무변화)
- [ ] **회귀 (품목)**: 품목코드 기본 "08"로 예약 정상 동작 확인
- [ ] 발송인 이름 미설정 시 명확한 에러 메시지 노출 확인
- [ ] (선택) 방문택배 1건 — 예약명·발송인 설정값 반영 확인

## 위험 / 하위호환

- **본인 환경 무변화 조건**: `.env.local`에 `SENDER_NAME=<GS 주소록의 발송인 이름>`이 있어야 함.
  현재 본인 `.env.local`의 `SENDER_NAME` 값이 실제 GS 주소록 이름("리커밋")과 일치하는지 **배포 전 확인 필요**.
  불일치 시 설정 UI 또는 env에서 맞추면 됨 (1회).
- **자동화 코드는 단위테스트 불가** (실제 GS 사이트 필요) → 문자열→설정값 치환 위주, 로직 변경 최소화.
  특히 `page.evaluate` 인자 주입 패턴을 정확히 (클로저 접근 불가).
- **품목코드 동적화**: 08 외 품목은 동의 체크박스 UI가 다를 수 있음 → fallback 유지 + 기본값 08로 본인 무변화.
- **기존 sender.* DB 행**: 방치해도 무해 (안 읽음).

## 작업 외 (Out of Scope)

- 내일배송 가능 지역(`regions.ts`): GS편의점택배 고정 서비스 스펙 → 일반화 대상 아님 (사용자 확정)
- 택배사 코드 `CJGLS`: GS편의점택배=CJ대한통운, 모든 GS 사용자 동일
- 배포 스크립트(`scripts/deploy-fast.sh`)의 SSH 경로: 본인 서버 특정값, README 안내로 충분 (코드 변경 X)
- 발송인 폼 직접입력 자동화 (ADR-0002에서 기각)

## 체크리스트
- [ ] 프로젝트 컨벤션 규칙 준수 (네이밍, 커밋)
- [ ] 민감 정보 하드코딩 없음 (개인이름·도메인 코드/문서에서 제거)
- [ ] 타입 안전성 확인 (SenderSettings 제거 후 빌드)
- [ ] 에러 핸들링 포함 (발송인 미설정 시 명확한 에러)
- [ ] ADR-0002 작성
- [ ] docs/adr/README.md 인덱스에 0002 추가
