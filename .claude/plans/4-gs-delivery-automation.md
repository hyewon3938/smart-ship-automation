# feat(gs-delivery): GS택배 Playwright 자동화 - 국내택배/내일배송 예약

## 이슈
- 번호: #4
- 브랜치: `feat/4-gs-delivery-automation`

## 개요

Phase 3 대시보드에서 "예약" 클릭 시 `status: "booking"`으로만 전환하던 것을,
실제로 GS택배(cvsnet.co.kr) 사이트에 Playwright headed 브라우저로 예약 폼을 자동 입력하는 기능을 구현한다.

## 선행 이슈: 주소 분리 저장

현재 `sync.ts`에서 네이버 API의 `baseAddress + detailAddress`를 합쳐서 `recipientAddress` 한 컬럼에 저장 중.
GS택배 폼은 기본주소/상세주소를 별도 필드로 입력받으므로, 합친 주소를 다시 파싱하면 손실이 생긴다.

**해결:** `recipientAddressDetail` 컬럼을 추가하여 네이버 API에서 받은 대로 분리 저장.
- `recipientAddress` → baseAddress만 저장
- `recipientAddressDetail` (신규) → detailAddress 저장
- OrderTable 등 UI에서는 두 값을 합쳐서 표시 (기존과 동일한 사용자 경험)
- 기존 데이터는 다음 동기화 시 자동 갱신

## 핵심 설계 결정

| 결정 | 선택 | 대안 | 이유 |
|------|------|------|------|
| 브라우저 모드 | headed 싱글턴 | headless | 사용자가 자동화 과정을 육안 확인 + 캡챠 수동 개입 가능 |
| 크리덴셜 | 환경변수 | settings DB | Phase 5에서 설정 페이지 구현 후 이관. 지금은 .env.local로 충분 |
| 큐 방식 | 인메모리 순차 큐 | Redis, BullMQ | 1인 로컬 앱에 외부 큐 오버엔지니어링. 재시작 시 booking→pending 복구로 충분 |
| 보내는 분 | 주소록에서 가져오기 | 환경변수 직접 입력 | 사용자가 GS택배에 이미 등록한 주소록 활용이 더 빠르고 안정적 |
| 셀렉터 관리 | 상수 파일 1곳 집중 | 각 함수에 인라인 | 사이트 변경 시 수정 포인트를 1곳으로 줄임 |
| 주소 저장 | base/detail 분리 | 합산 후 regex 파싱 | 네이버 API가 분리 제공 → 정보 손실 없이 재사용 |

## 변경 파일 목록

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `src/lib/db/schema.ts` | 수정 | `recipientAddressDetail` 컬럼 추가 |
| `src/lib/naver/sync.ts` | 수정 | 주소를 base/detail 분리 저장 |
| `src/components/OrderTable.tsx` | 수정 | 주소 표시 시 base+detail 합산 |
| `src/components/BookingConfirmDialog.tsx` | 수정 | (필요 시) 주소 표시 부분 |
| `src/lib/gs-delivery/types.ts` | 신규 | BookingResult, BookingTask 타입 |
| `src/lib/gs-delivery/selectors.ts` | 신규 | URL/CSS 셀렉터 상수 |
| `src/lib/gs-delivery/browser.ts` | 신규 | Playwright 브라우저 싱글턴 |
| `src/lib/gs-delivery/auth.ts` | 신규 | cvsnet.co.kr 로그인/세션 관리 |
| `src/lib/gs-delivery/automation.ts` | 신규 | 예약 폼 자동 입력 (국내/내일배송) |
| `src/lib/gs-delivery/worker.ts` | 신규 | 순차 예약 큐 + 오케스트레이션 |
| `src/lib/orders.ts` | 수정 | updateOrderStatus, addBookingLog, getOrdersByIds, recoverStuckBookings 추가 |
| `src/types/index.ts` | 수정 | BookingLogEntry 타입 추가 |
| `src/app/api/orders/book/route.ts` | 수정 | 워커 트리거 연동 |

---

## 구현 상세

### 1. DB 스키마 변경 (`src/lib/db/schema.ts`)

**Before:**
```typescript
recipientAddress: text("recipient_address").notNull(),
recipientZipCode: text("recipient_zip_code").notNull(),
```

**After:**
```typescript
recipientAddress: text("recipient_address").notNull(),
recipientAddressDetail: text("recipient_address_detail"),
recipientZipCode: text("recipient_zip_code").notNull(),
```

**설명:** nullable로 추가하여 기존 데이터 호환. 다음 `npx drizzle-kit push`로 마이그레이션.

### 2. 동기화 로직 수정 (`src/lib/naver/sync.ts`)

**Before:**
```typescript
const address =
  `${order.shippingAddress.baseAddress} ${order.shippingAddress.detailAddress ?? ""}`.trim();
// ...
recipientAddress: address,
```

**After:**
```typescript
const baseAddress = order.shippingAddress.baseAddress;
const detailAddress = order.shippingAddress.detailAddress ?? null;
const fullAddress = `${baseAddress} ${detailAddress ?? ""}`.trim();
const isNextDay = isNextDayDeliveryEligible(fullAddress);
// ...
recipientAddress: baseAddress,
recipientAddressDetail: detailAddress,
```

**설명:** `isNextDayDeliveryEligible`에는 합산 주소를 넘기고 (기존 로직 유지), DB에는 분리 저장.

### 3. UI 주소 표시 수정 (`src/components/OrderTable.tsx`)

**Before:**
```tsx
<p className="text-sm">
  {truncate(order.recipientAddress, MAX_ADDRESS_LENGTH)}
</p>
```

**After:**
```tsx
<p className="text-sm">
  {truncate(
    `${order.recipientAddress} ${order.recipientAddressDetail ?? ""}`.trim(),
    MAX_ADDRESS_LENGTH
  )}
</p>
```

**설명:** 사용자에게 보이는 주소는 기존과 동일하게 합산 표시.

### 4. GS택배 타입 정의 (`src/lib/gs-delivery/types.ts`)

```typescript
/** 단건 예약 결과 */
export interface BookingResult {
  success: boolean;
  reservationNo?: string;
  error?: string;
  screenshotPath?: string;
}

/** 워커에 전달할 예약 작업 단위 */
export interface BookingTask {
  orderId: number;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  recipientAddressDetail: string | null;
  recipientZipCode: string;
  deliveryType: "domestic" | "nextDay";
  productName: string;
  totalPrice: number;
  quantity: number;
}
```

### 5. CSS 셀렉터 상수 (`src/lib/gs-delivery/selectors.ts`)

```typescript
/**
 * GS택배(cvsnet.co.kr) URL 및 CSS 셀렉터
 *
 * ⚠️ 구현 시 실제 사이트 DevTools로 확인하여 교체할 것
 * 사이트 UI 변경 시 이 파일만 수정하면 됨
 */

// ── URL ──
export const GS_URLS = {
  LOGIN: "https://www.cvsnet.co.kr/member/login/index.do",
  DOMESTIC: "https://www.cvsnet.co.kr/reservation-inquiry/domestic/index.do",
  NEXT_DAY: "https://www.cvsnet.co.kr/reservation-inquiry/nextday/index.do",
  // TODO: 내일배송 URL은 사이트에서 정확한 경로 확인
} as const;

// ── 로그인 ──
export const LOGIN_SELECTORS = {
  USERNAME: "#id",                // TODO: 실제 셀렉터 확인
  PASSWORD: "#pw",                // TODO: 실제 셀렉터 확인
  SUBMIT: ".btn-login",           // TODO: 실제 셀렉터 확인
  LOGGED_IN_INDICATOR: ".user-info", // TODO: 로그인 후 나타나는 요소
} as const;

// ── 국내택배 예약 폼 ──
export const DOMESTIC_SELECTORS = {
  // 물품 정보
  PRODUCT_SELECT: "#productType",         // TODO: 물품선택 드롭다운
  PRODUCT_PRICE: "#productPrice",         // TODO: 물품가액
  RESERVATION_NAME: "#reservationName",   // TODO: 예약명

  // 보내는 분 (주소록)
  SENDER_ADDRESSBOOK_BTN: ".btn-address-book",  // TODO: "주소록에서 가져오기" 버튼
  SENDER_ADDRESSBOOK_FIRST: ".address-list .item:first-child", // TODO: 주소록 첫 항목

  // 받는 분
  RECIPIENT_NAME: "#recipientName",         // TODO: 이름
  RECIPIENT_PHONE: "#recipientPhone",       // TODO: 전화번호
  RECIPIENT_ZIPCODE: "#recipientZip",       // TODO: 우편번호
  RECIPIENT_ADDRESS: "#recipientAddr",      // TODO: 기본주소
  RECIPIENT_ADDRESS_DETAIL: "#recipientAddrDetail", // TODO: 상세주소
  ZIPCODE_SEARCH_BTN: ".btn-zipcode",       // TODO: 우편번호 검색 버튼 (사용 여부 확인)

  // 제출 & 결과
  SUBMIT: ".btn-submit",                    // TODO: 예약 신청 버튼
  CONFIRM_OK: ".btn-confirm",               // TODO: 확인 팝업 OK 버튼 (있을 경우)
  SUCCESS_INDICATOR: ".reservation-complete",// TODO: 완료 페이지 식별자
  RESERVATION_NO: ".reservation-number",    // TODO: 예약번호 텍스트 위치
} as const;

// ── 내일배송 예약 폼 ──
// 국내택배와 동일 구조일 가능성 높음. 다르면 개별 오버라이드
export const NEXT_DAY_SELECTORS = {
  ...DOMESTIC_SELECTORS,
  // TODO: 내일배송 전용 필드가 있으면 여기에 오버라이드
} as const;

// ── 타이밍 상수 ──
/** 로그인 성공 대기 (캡챠 수동 개입 포함) */
export const LOGIN_TIMEOUT_MS = 60_000;
/** 폼 액션 간 대기 */
export const ACTION_DELAY_MS = 500;
/** 페이지 로드 타임아웃 */
export const PAGE_LOAD_TIMEOUT_MS = 15_000;
```

### 6. 브라우저 싱글턴 (`src/lib/gs-delivery/browser.ts`)

```typescript
import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";

let browser: Browser | null = null;
let context: BrowserContext | null = null;

/**
 * Playwright 브라우저 인스턴스 (싱글턴, headed 모드).
 * 이미 열려 있으면 재사용, 닫혔으면 새로 시작.
 */
export async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;

  browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  browser.on("disconnected", () => {
    browser = null;
    context = null;
  });

  return browser;
}

/**
 * BrowserContext (로그인 세션 유지용).
 * 하나의 컨텍스트를 재활용하여 쿠키/세션 유지.
 */
export async function getContext(): Promise<BrowserContext> {
  if (context) return context;

  const b = await getBrowser();
  context = await b.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "ko-KR",
  });

  return context;
}

/** 새 페이지(탭) 생성. 각 예약 작업마다 열고 완료 후 닫는다. */
export async function newPage(): Promise<Page> {
  const ctx = await getContext();
  return ctx.newPage();
}

/** 브라우저 + 컨텍스트 전체 정리 */
export async function closeBrowser(): Promise<void> {
  if (context) {
    await context.close().catch(() => {});
    context = null;
  }
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}
```

### 7. 로그인 관리 (`src/lib/gs-delivery/auth.ts`)

```typescript
import { getContext, newPage } from "./browser";
import {
  GS_URLS,
  LOGIN_SELECTORS,
  LOGIN_TIMEOUT_MS,
  ACTION_DELAY_MS,
} from "./selectors";
import type { Page } from "playwright";

/**
 * 현재 로그인 상태를 확인한다.
 * 국내택배 페이지에 접근하여 로그인 여부를 판별.
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    // 이미 cvsnet 페이지에 있으면 현재 페이지에서 확인
    const url = page.url();
    if (!url.includes("cvsnet.co.kr")) {
      await page.goto(GS_URLS.DOMESTIC, { waitUntil: "domcontentloaded" });
    }

    return await page
      .locator(LOGIN_SELECTORS.LOGGED_IN_INDICATOR)
      .isVisible({ timeout: 3000 })
      .catch(() => false);
  } catch {
    return false;
  }
}

/**
 * cvsnet.co.kr에 로그인한다.
 *
 * 캡챠가 있을 경우 사용자가 headed 브라우저에서 직접 풀 때까지
 * 최대 LOGIN_TIMEOUT_MS(60초)간 대기.
 *
 * @throws 60초 내 로그인 미완료 시 에러
 */
export async function login(page: Page): Promise<void> {
  const username = process.env.GS_USERNAME;
  const password = process.env.GS_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "GS_USERNAME 또는 GS_PASSWORD가 설정되지 않았습니다. .env.local을 확인하세요."
    );
  }

  // 로그인 페이지로 이동
  await page.goto(GS_URLS.LOGIN, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(ACTION_DELAY_MS);

  // ID/PW 입력
  await page.locator(LOGIN_SELECTORS.USERNAME).fill(username);
  await page.locator(LOGIN_SELECTORS.PASSWORD).fill(password);
  await page.waitForTimeout(ACTION_DELAY_MS);

  // 로그인 버튼 클릭
  await page.locator(LOGIN_SELECTORS.SUBMIT).click();

  // 로그인 성공 대기 (캡챠 시 사용자 수동 개입 대기 포함)
  try {
    await page.waitForSelector(LOGIN_SELECTORS.LOGGED_IN_INDICATOR, {
      timeout: LOGIN_TIMEOUT_MS,
    });
  } catch {
    throw new Error(
      "로그인 실패: 60초 내에 로그인이 완료되지 않았습니다. " +
      "브라우저 창에서 캡챠를 확인하세요."
    );
  }
}

/**
 * 로그인 상태를 보장한다. 미로그인 시 로그인 시도.
 */
export async function ensureLoggedIn(page: Page): Promise<void> {
  const loggedIn = await isLoggedIn(page);
  if (!loggedIn) {
    await login(page);
  }
}
```

### 8. 예약 폼 자동 입력 (`src/lib/gs-delivery/automation.ts`)

```typescript
import {
  GS_URLS,
  DOMESTIC_SELECTORS,
  NEXT_DAY_SELECTORS,
  ACTION_DELAY_MS,
  PAGE_LOAD_TIMEOUT_MS,
} from "./selectors";
import type { Page } from "playwright";
import type { BookingResult, BookingTask } from "./types";

import fs from "fs";
import path from "path";

const SCREENSHOTS_DIR = path.join(process.cwd(), "data", "screenshots");

/**
 * 국내택배 예약 1건 실행
 */
export async function bookDomestic(
  page: Page,
  task: BookingTask
): Promise<BookingResult> {
  return fillAndSubmitForm(page, task, GS_URLS.DOMESTIC, DOMESTIC_SELECTORS);
}

/**
 * 내일배송 예약 1건 실행
 */
export async function bookNextDay(
  page: Page,
  task: BookingTask
): Promise<BookingResult> {
  return fillAndSubmitForm(page, task, GS_URLS.NEXT_DAY, NEXT_DAY_SELECTORS);
}

/**
 * 예약 폼 공통 로직
 * 국내택배와 내일배송이 동일 구조이므로 URL과 셀렉터만 주입받는다.
 * 구조가 크게 다르면 이 함수를 분리한다.
 */
async function fillAndSubmitForm(
  page: Page,
  task: BookingTask,
  url: string,
  S: typeof DOMESTIC_SELECTORS
): Promise<BookingResult> {
  try {
    // ── 1. 예약 페이지 이동 ──
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_LOAD_TIMEOUT_MS,
    });
    await page.waitForTimeout(ACTION_DELAY_MS);

    // ── 2. 물품 정보 ──
    // 물품선택: select 또는 radio 등 사이트 구조에 따라 조정
    // TODO: 실제 사이트 확인 후 selectOption / click 결정
    // await page.locator(S.PRODUCT_SELECT).selectOption("기타");
    await page.locator(S.PRODUCT_PRICE).fill(String(task.totalPrice));
    await page.locator(S.RESERVATION_NAME).fill(`네이버-${task.recipientName}`);
    await page.waitForTimeout(ACTION_DELAY_MS);

    // ── 3. 보내는 분: 주소록에서 가져오기 ──
    await page.locator(S.SENDER_ADDRESSBOOK_BTN).click();
    await page.waitForTimeout(ACTION_DELAY_MS);

    // 주소록 팝업이 새 창(popup)인 경우:
    //   const popup = await page.waitForEvent("popup");
    //   await popup.locator(S.SENDER_ADDRESSBOOK_FIRST).click();
    //   await popup.close();
    //
    // 같은 페이지 내 모달인 경우:
    await page.locator(S.SENDER_ADDRESSBOOK_FIRST).click();
    await page.waitForTimeout(ACTION_DELAY_MS);
    // TODO: 실제 주소록 UI 구조 확인 후 popup vs modal 분기

    // ── 4. 받는 분 정보 ──
    await page.locator(S.RECIPIENT_NAME).fill(task.recipientName);
    await page.locator(S.RECIPIENT_PHONE).fill(
      task.recipientPhone.replace(/-/g, "")
    );

    // 우편번호: 직접 입력 가능한 경우 fill, 검색 팝업만 허용 시 다른 방식 필요
    // TODO: 우편번호 필드가 readonly인지 확인. readonly면 검색 팝업 자동화 필요.
    await page.locator(S.RECIPIENT_ZIPCODE).fill(task.recipientZipCode);
    await page.locator(S.RECIPIENT_ADDRESS).fill(task.recipientAddress);
    if (task.recipientAddressDetail) {
      await page.locator(S.RECIPIENT_ADDRESS_DETAIL).fill(
        task.recipientAddressDetail
      );
    }
    await page.waitForTimeout(ACTION_DELAY_MS);

    // ── 5. 제출 ──
    await page.locator(S.SUBMIT).click();

    // 확인 팝업이 뜨는 경우 (예: "예약하시겠습니까?")
    const confirmBtn = page.locator(S.CONFIRM_OK);
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    // ── 6. 결과 확인 ──
    await page.waitForSelector(S.SUCCESS_INDICATOR, {
      timeout: PAGE_LOAD_TIMEOUT_MS,
    });

    const reservationNo = await page
      .locator(S.RESERVATION_NO)
      .textContent()
      .then((t) => t?.trim() ?? "")
      .catch(() => "");

    return {
      success: true,
      reservationNo: reservationNo || undefined,
    };
  } catch (error) {
    const screenshotPath = await saveScreenshot(page, task.orderId);
    return {
      success: false,
      error: error instanceof Error ? error.message : "알 수 없는 오류",
      screenshotPath,
    };
  }
}

/**
 * 에러 시 스크린샷 저장
 * 경로: data/screenshots/order-{id}-{timestamp}.png
 */
async function saveScreenshot(
  page: Page,
  orderId: number
): Promise<string> {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  const filename = `order-${orderId}-${Date.now()}.png`;
  const filepath = path.join(SCREENSHOTS_DIR, filename);

  await page.screenshot({ path: filepath, fullPage: true });
  return filepath;
}
```

### 9. 순차 예약 큐 (`src/lib/gs-delivery/worker.ts`)

```typescript
import { closeBrowser, newPage } from "./browser";
import { ensureLoggedIn } from "./auth";
import { bookDomestic, bookNextDay } from "./automation";
import { addBookingLog, updateOrderStatus, recoverStuckBookings } from "@/lib/orders";
import type { BookingTask } from "./types";

// ── 큐 상태 ──
const queue: BookingTask[] = [];
let isProcessing = false;
let initialized = false;

/**
 * 모듈 초기화: "booking" 상태로 멈춘 주문을 "pending"으로 복구.
 * 서버 재시작 후 첫 호출 시 1회 실행.
 */
function initOnce(): void {
  if (initialized) return;
  initialized = true;

  const recovered = recoverStuckBookings();
  if (recovered > 0) {
    console.log(
      `[worker] ${recovered}건의 중단된 예약을 pending으로 복구했습니다.`
    );
  }
}

/**
 * 예약 작업을 큐에 추가하고 처리를 시작한다.
 */
export function enqueueBookings(tasks: BookingTask[]): void {
  initOnce();
  queue.push(...tasks);
  processNext();
}

/**
 * 큐에서 1건씩 꺼내 순차 처리. 큐가 빌 때까지 반복.
 */
async function processNext(): Promise<void> {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;

  const task = queue.shift()!;

  try {
    await processSingleOrder(task);
  } catch (error) {
    // 예상치 못한 에러 (브라우저 크래시 등)
    const msg = error instanceof Error ? error.message : "알 수 없는 오류";
    updateOrderStatus(task.orderId, "failed", msg);
    addBookingLog(task.orderId, "error", `예상치 못한 실패: ${msg}`);

    // 브라우저 문제일 가능성 → 정리 후 다음 건에서 새로 시작
    await closeBrowser();
  } finally {
    isProcessing = false;
    processNext(); // 다음 건 처리
  }
}

/**
 * 단일 주문 예약 처리
 */
async function processSingleOrder(task: BookingTask): Promise<void> {
  addBookingLog(task.orderId, "start", `예약 시작: ${task.recipientName}`);

  const page = await newPage();

  try {
    // 1. 로그인 보장
    await ensureLoggedIn(page);
    addBookingLog(task.orderId, "login", "로그인 확인 완료");

    // 2. 택배 유형에 따라 폼 자동화 실행
    const result =
      task.deliveryType === "nextDay"
        ? await bookNextDay(page, task)
        : await bookDomestic(page, task);

    // 3. DB 상태 반영
    if (result.success) {
      updateOrderStatus(
        task.orderId,
        "booked",
        JSON.stringify({ reservationNo: result.reservationNo }),
        result.reservationNo
      );
      addBookingLog(
        task.orderId,
        "complete",
        `예약 완료${result.reservationNo ? `: ${result.reservationNo}` : ""}`
      );
    } else {
      updateOrderStatus(task.orderId, "failed", result.error ?? "알 수 없는 오류");
      addBookingLog(
        task.orderId,
        "error",
        `예약 실패: ${result.error}`,
        result.screenshotPath
      );
    }
  } finally {
    await page.close().catch(() => {});
  }
}

/** 현재 큐 상태 조회 */
export function getWorkerStatus(): {
  isProcessing: boolean;
  queueLength: number;
} {
  return { isProcessing, queueLength: queue.length };
}
```

### 10. 주문 서비스 함수 추가 (`src/lib/orders.ts`)

기존 코드 유지 + 아래 함수 4개 추가.

**import 변경:**
```typescript
// Before
import { orders } from "@/lib/db/schema";

// After
import { orders, bookingLogs } from "@/lib/db/schema";
```

**추가할 함수:**

```typescript
/** 복수 주문 조회 (워커에서 사용) */
export function getOrdersByIds(ids: number[]) {
  return db.select().from(orders).where(inArray(orders.id, ids)).all();
}

/** 주문 상태 업데이트 (워커 결과 반영) */
export function updateOrderStatus(
  id: number,
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
    .where(eq(orders.id, id))
    .run();
}

/** 예약 로그 기록 */
export function addBookingLog(
  orderId: number,
  action: string,
  detail?: string,
  screenshotPath?: string
): void {
  db.insert(bookingLogs)
    .values({
      orderId,
      action,
      detail: detail ?? null,
      screenshotPath: screenshotPath ?? null,
    })
    .run();
}

/**
 * "booking" 상태로 멈춘 주문을 "pending"으로 복구.
 * 서버 재시작 시 워커 초기화에서 호출.
 */
export function recoverStuckBookings(): number {
  const stuck = db
    .select()
    .from(orders)
    .where(eq(orders.status, "booking" as OrderStatus))
    .all();

  if (stuck.length === 0) return 0;

  db.update(orders)
    .set({ status: "pending", updatedAt: new Date().toISOString() })
    .where(eq(orders.status, "booking" as OrderStatus))
    .run();

  return stuck.length;
}
```

### 11. 타입 추가 (`src/types/index.ts`)

기존 타입 유지 + 추가:

```typescript
/** 예약 로그 항목 */
export interface BookingLogEntry {
  id: number;
  orderId: number;
  action: string;
  detail: string | null;
  screenshotPath: string | null;
  createdAt: string;
}
```

### 12. API 라우트 수정 (`src/app/api/orders/book/route.ts`)

**Before:**
```typescript
import { bookOrders } from "@/lib/orders";

export async function POST(request: NextRequest) {
  try {
    const { orderIds } = await request.json();
    // ... validation ...
    const result = bookOrders(orderIds);
    return NextResponse.json({
      message: `${result.count}건 예약이 시작되었습니다`,
      ...result,
    });
  } catch (error) {
    // ...
  }
}
```

**After:**
```typescript
import { bookOrders, getOrdersByIds } from "@/lib/orders";
import { enqueueBookings } from "@/lib/gs-delivery/worker";
import type { BookingTask } from "@/lib/gs-delivery/types";

export async function POST(request: NextRequest) {
  try {
    const { orderIds } = await request.json();

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { error: "예약할 주문 ID 목록이 필요합니다" },
        { status: 400 }
      );
    }

    // 1. 상태 → booking (기존 로직)
    const result = bookOrders(orderIds);

    // 2. 워커에 예약 작업 전달 (비동기, 즉시 반환)
    const targetOrders = getOrdersByIds(orderIds);
    const tasks: BookingTask[] = targetOrders.map((order) => ({
      orderId: order.id,
      recipientName: order.recipientName,
      recipientPhone: order.recipientPhone,
      recipientAddress: order.recipientAddress,
      recipientAddressDetail: order.recipientAddressDetail ?? null,
      recipientZipCode: order.recipientZipCode,
      deliveryType: order.selectedDeliveryType as "domestic" | "nextDay",
      productName: order.productName,
      totalPrice: order.totalPrice ?? 0,
      quantity: order.quantity,
    }));

    enqueueBookings(tasks);

    return NextResponse.json({
      message: `${result.count}건 예약이 시작되었습니다`,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
```

**설명:** `bookOrders()`로 DB 상태 전환 후 `enqueueBookings()`로 워커에 fire-and-forget. API는 즉시 응답 반환. 프론트엔드는 3초 폴링(Phase 3)으로 상태 변경 감지.

---

## 커밋 계획

1. `feat(db): 주문 테이블에 상세주소 컬럼 추가` - [schema.ts, sync.ts, OrderTable.tsx, drizzle push]
2. `feat(gs-delivery): 타입, 셀렉터, 브라우저 싱글턴` - [types.ts, selectors.ts, browser.ts]
3. `feat(gs-delivery): 로그인 자동화` - [auth.ts]
4. `feat(gs-delivery): 국내택배/내일배송 예약 폼 자동화` - [automation.ts]
5. `feat(gs-delivery): 순차 예약 큐 및 API 연동` - [worker.ts, orders.ts, types/index.ts, book/route.ts]

## 테스트 계획

- [ ] `npm run build` 통과 (TypeScript 타입 에러 없음)
- [ ] `npx drizzle-kit push` 스키마 마이그레이션 성공
- [ ] splitAddress 대신 DB에서 분리 저장된 주소가 올바르게 사용되는지 확인
- [ ] 셀렉터 검증: 실제 cvsnet.co.kr 사이트 DevTools로 확인 (수동)
- [ ] 로그인 테스트: headed 모드 브라우저에서 실제 로그인 (수동)
- [ ] 국내택배 1건 예약 테스트: 실제 주문 데이터 사용 (수동)

## 체크리스트

- [ ] 프로젝트 컨벤션 준수 (네이밍, import 순서, 레이어 분리)
- [ ] 민감 정보 하드코딩 없음 (GS_USERNAME/GS_PASSWORD → .env.local)
- [ ] 타입 안전성 (any 미사용, DeliveryType/OrderStatus 정합)
- [ ] 에러 핸들링 (각 단계 try/catch + 스크린샷 + bookingLogs 기록)
- [ ] bookingLogs 테이블에 예약 과정 전체 기록

## 구현 시 주의 (Sonnet 참고)

1. **셀렉터는 전부 placeholder.** `selectors.ts` 값을 실제 사이트에서 DevTools로 확인하여 교체해야 한다.
   - 브라우저를 headless: false로 열고 cvsnet.co.kr 접속하여 Inspector로 확인
   - 셀렉터 확인 후 반드시 `selectors.ts`에 반영

2. **주소록 팝업 구조 확인 필요.** 새 창(popup)인지 같은 페이지 모달인지에 따라 `automation.ts`의 주소록 코드가 달라짐.

3. **우편번호 필드 readonly 여부.** 직접 입력 불가면 다음/카카오 우편번호 검색 팝업 자동화가 필요할 수 있음.

4. **물품선택 UI 확인.** select, radio, custom dropdown 등 UI 타입에 따라 interaction 방식 결정.

5. **내일배송 URL 확인.** `GS_URLS.NEXT_DAY`가 실제 URL과 맞는지 확인.

6. **drizzle push 실행 필수.** 스키마 변경 후 `npx drizzle-kit push`로 DB 마이그레이션.

## 히스토리 기록

```markdown
### Phase 4: GS택배 Playwright 자동화
- **완료일:** YYYY-MM-DD
- **PR:** #N
- **주요 변경:**
  - DB 스키마: recipientAddressDetail 컬럼 추가 (주소 분리 저장)
  - Playwright headed 모드 브라우저 싱글턴 (세션 재활용)
  - cvsnet.co.kr 로그인 자동화 (캡챠 시 60초 수동 개입 대기)
  - 국내택배/내일배송 별도 URL 폼 자동 입력
  - 순차 예약 큐 (인메모리, 1건씩 처리)
  - 실패 시 스크린샷 저장 (data/screenshots/)
  - bookingLogs 테이블 활용한 예약 과정 전체 로깅
  - POST /api/orders/book에서 워커 fire-and-forget 트리거
  - 서버 재시작 시 booking→pending 자동 복구
- **기술적 결정:**
  - 네이버 API baseAddress/detailAddress 분리 저장 → GS택배 폼에 그대로 사용, regex 파싱 불필요
  - 인메모리 큐 선택 → 1인 로컬 앱에 Redis 오버엔지니어링
  - 셀렉터 중앙 집중 관리 (selectors.ts) → 사이트 변경 시 수정 포인트 1곳
  - BrowserContext 재활용 → 로그인 세션 유지, 매번 재로그인 방지
- **이슈/교훈:**
  - [구현 시 발견사항 기록]
```
