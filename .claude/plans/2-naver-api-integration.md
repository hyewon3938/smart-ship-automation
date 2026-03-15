# feat(naver): 네이버 커머스 API 연동 - 발송대기 주문 조회

## 이슈
- 번호: #2
- 브랜치: `feat/2-naver-api-integration`

## 개요
네이버 커머스 API OAuth 2.0 인증을 구현하고, 발송대기(PAYED) 주문을 조회하여 로컬 SQLite DB에 동기화한다.
주문 조회는 2단계: ① 변경 주문 ID 목록 조회 → ② 주문 상세 조회 (수령자 정보 포함).

## 변경 파일 목록

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `src/lib/naver/auth.ts` | 신규 생성 | OAuth 토큰 생성 (bcrypt 서명 + 토큰 캐싱) |
| `src/lib/naver/auth.test.ts` | 신규 생성 | bcrypt 서명 생성 유닛 테스트 |
| `src/lib/naver/orders.ts` | 신규 생성 | 주문 조회 서비스 (변경분 조회 + 상세 조회) |
| `src/lib/naver/regions.ts` | 신규 생성 | 내일배송 가능 지역 판별 |
| `src/lib/naver/regions.test.ts` | 신규 생성 | 내일배송 지역 판별 유닛 테스트 |
| `src/lib/naver/sync.ts` | 신규 생성 | DB 동기화 로직 (중복 방지, upsert) |
| `src/lib/naver/types.ts` | 신규 생성 | 네이버 API 응답 zod 스키마 |
| `src/lib/orders.ts` | 신규 생성 | 주문 DB 쿼리 서비스 (목록 조회) |
| `src/app/api/orders/route.ts` | 신규 생성 | GET /api/orders - 주문 목록 API |
| `src/app/api/orders/sync/route.ts` | 신규 생성 | POST /api/orders/sync - 동기화 트리거 API |
| `src/types/index.ts` | 수정 | Order 타입 등 공유 타입 추가 |

## 구현 상세

### 1. 네이버 API 응답 타입 및 zod 스키마 (`src/lib/naver/types.ts`)

네이버 API 응답을 zod로 검증한다. 공식 문서 접근이 제한적이므로, 실제 응답 기반으로 스키마를 조정할 수 있도록 유연하게 설계한다.

```typescript
import { z } from "zod/v4";

// 토큰 응답
export const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(), // 초 단위 (문서에 명시 안됨, 기본 24시간으로 가정)
  token_type: z.string().optional(),
});

export type TokenResponse = z.infer<typeof tokenResponseSchema>;

// 변경 주문 목록 응답 (Step 1)
// GET /v1/pay-order/seller/product-orders/last-changed-statuses
export const lastChangedStatusesResponseSchema = z.object({
  data: z.object({
    lastChangeStatuses: z.array(
      z.object({
        productOrderId: z.string(),
        orderId: z.string(),
        lastChangedType: z.string(),
      })
    ),
  }),
});

export type LastChangedStatusesResponse = z.infer<typeof lastChangedStatusesResponseSchema>;

// 주문 상세 응답 (Step 2)
// POST /v1/pay-order/seller/product-orders/query
export const productOrderDetailSchema = z.object({
  productOrderId: z.string(),
  orderId: z.string(),
  orderDate: z.string(),
  productName: z.string(),
  quantity: z.number(),
  optionManageCode: z.string().optional(),
  totalPaymentAmount: z.number(),
  shippingAddress: z.object({
    name: z.string(),
    tel1: z.string(),
    baseAddress: z.string(),
    detailAddress: z.string().optional(),
    zipCode: z.string(),
  }),
  placeOrderStatus: z.string(),
});

export const productOrdersQueryResponseSchema = z.object({
  data: z.array(
    z.object({
      productOrder: productOrderDetailSchema,
    })
  ),
});

export type ProductOrderDetail = z.infer<typeof productOrderDetailSchema>;
export type ProductOrdersQueryResponse = z.infer<typeof productOrdersQueryResponseSchema>;
```

**설명:** zod v4 사용. 네이버 API 응답의 정확한 필드명은 실제 테스트 시 확인 후 조정이 필요할 수 있음. `.passthrough()`를 사용하지 않고 strict 파싱하여 예상치 못한 필드 변경을 감지한다.

> **주의:** 네이버 커머스 API 공식 문서(apicenter.commerce.naver.com)에 직접 접근할 수 없어 커뮤니티 소스 기반으로 스키마를 작성함. 첫 API 호출 시 응답을 로깅하여 실제 스키마와 대조한 뒤 필드명을 보정해야 함.

### 2. OAuth 인증 (`src/lib/naver/auth.ts`)

bcrypt 기반 client_secret_sign 생성 + 토큰 발급/캐싱.

```typescript
import bcryptjs from "bcryptjs";

const TOKEN_URL = "https://api.commerce.naver.com/external/v1/oauth2/token";
const TOKEN_BUFFER_MS = 60_000; // 만료 1분 전 갱신

// 모듈 레벨 토큰 캐시
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/**
 * bcrypt 기반 client_secret_sign 생성
 * password = `${clientId}_${timestamp}`
 * hash = bcrypt(password, clientSecret) // clientSecret이 salt 역할
 * sign = base64Encode(hash)
 */
export function generateClientSecretSign(
  clientId: string,
  clientSecret: string,
  timestamp: number
): string {
  const password = `${clientId}_${timestamp}`;
  const hashed = bcryptjs.hashSync(password, clientSecret);
  return Buffer.from(hashed).toString("base64");
}

/**
 * OAuth 토큰 발급
 */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();

  // 캐시된 토큰이 유효하면 재사용
  if (cachedToken && cachedToken.expiresAt > now + TOKEN_BUFFER_MS) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET이 설정되지 않았습니다.");
  }

  const timestamp = now;
  const clientSecretSign = generateClientSecretSign(clientId, clientSecret, timestamp);

  const params = new URLSearchParams({
    client_id: clientId,
    timestamp: String(timestamp),
    client_secret_sign: clientSecretSign,
    grant_type: "client_credentials",
    type: "SELF",
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`토큰 발급 실패 (${response.status}): ${body}`);
  }

  const json = await response.json();
  const parsed = tokenResponseSchema.parse(json);

  // expires_in이 없으면 기본 24시간(보수적으로 설정)
  const expiresInMs = (parsed.expires_in ?? 86400) * 1000;

  cachedToken = {
    accessToken: parsed.access_token,
    expiresAt: now + expiresInMs,
  };

  return cachedToken.accessToken;
}

// 테스트용 캐시 리셋
export function _resetTokenCache(): void {
  cachedToken = null;
}
```

**설명:**
- `bcryptjs.hashSync`를 사용하여 client_secret을 salt로 bcrypt 해싱
- 모듈 레벨 캐시로 토큰 재사용 (만료 1분 전 자동 갱신)
- 환경변수 누락 시 명확한 에러 메시지

### 3. 인증 유닛 테스트 (`src/lib/naver/auth.test.ts`)

```typescript
import { describe, it, expect } from "vitest";
import { generateClientSecretSign } from "./auth";

describe("generateClientSecretSign", () => {
  it("동일 입력에 대해 일관된 서명을 생성한다", () => {
    // bcrypt는 salt가 동일하면 동일 결과
    const clientId = "test_client_id";
    const clientSecret = "$2a$04$YourSaltValueHere22characters";
    const timestamp = 1700000000000;

    const sign1 = generateClientSecretSign(clientId, clientSecret, timestamp);
    const sign2 = generateClientSecretSign(clientId, clientSecret, timestamp);

    expect(sign1).toBe(sign2);
  });

  it("base64 인코딩된 문자열을 반환한다", () => {
    const clientId = "test_client_id";
    const clientSecret = "$2a$04$YourSaltValueHere22characters";
    const timestamp = 1700000000000;

    const sign = generateClientSecretSign(clientId, clientSecret, timestamp);

    // base64 디코딩이 가능한지 확인
    expect(() => Buffer.from(sign, "base64")).not.toThrow();
    expect(sign.length).toBeGreaterThan(0);
  });

  it("다른 timestamp면 다른 서명을 생성한다", () => {
    const clientId = "test_client_id";
    const clientSecret = "$2a$04$YourSaltValueHere22characters";

    const sign1 = generateClientSecretSign(clientId, clientSecret, 1700000000000);
    const sign2 = generateClientSecretSign(clientId, clientSecret, 1700000001000);

    expect(sign1).not.toBe(sign2);
  });
});
```

### 4. 주문 조회 서비스 (`src/lib/naver/orders.ts`)

2단계 주문 조회: 변경 ID 목록 → 상세 조회. Rate Limit 대응 포함.

```typescript
import { getAccessToken } from "./auth";
import {
  lastChangedStatusesResponseSchema,
  productOrdersQueryResponseSchema,
} from "./types";
import type { ProductOrderDetail } from "./types";

const BASE_URL = "https://api.commerce.naver.com/external/v1";
const MAX_BATCH_SIZE = 300; // 네이버 API 배치 최대 크기
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

/**
 * Rate limit 대응 지수 백오프 fetch 래퍼
 */
async function fetchWithRetry(url: string, options: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(url, options);

    if (response.status === 429) {
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, backoff));
      continue;
    }

    return response;
  }

  throw new Error(`API 요청 실패: ${MAX_RETRIES}회 재시도 후에도 429 에러`);
}

/**
 * Step 1: 변경 상품 주문 ID 목록 조회
 * 최근 24시간 내 PAYED 상태로 변경된 주문을 가져온다
 */
export async function fetchChangedProductOrderIds(): Promise<
  { productOrderId: string; orderId: string }[]
> {
  const token = await getAccessToken();

  // 24시간 전부터 현재까지 조회
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    lastChangedFrom: from.toISOString(),
    lastChangedType: "PAYED",
  });

  const response = await fetchWithRetry(
    `${BASE_URL}/pay-order/seller/product-orders/last-changed-statuses?${params}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`변경 주문 조회 실패 (${response.status}): ${body}`);
  }

  const json = await response.json();
  const parsed = lastChangedStatusesResponseSchema.parse(json);

  return parsed.data.lastChangeStatuses.map((s) => ({
    productOrderId: s.productOrderId,
    orderId: s.orderId,
  }));
}

/**
 * Step 2: 상품 주문 상세 조회 (배치)
 * productOrderId 목록으로 수령자 정보를 포함한 상세 데이터 조회
 */
export async function fetchProductOrderDetails(
  productOrderIds: string[]
): Promise<ProductOrderDetail[]> {
  if (productOrderIds.length === 0) return [];

  const token = await getAccessToken();
  const results: ProductOrderDetail[] = [];

  // MAX_BATCH_SIZE 단위로 나눠서 요청
  for (let i = 0; i < productOrderIds.length; i += MAX_BATCH_SIZE) {
    const batch = productOrderIds.slice(i, i + MAX_BATCH_SIZE);

    const response = await fetchWithRetry(
      `${BASE_URL}/pay-order/seller/product-orders/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ productOrderIds: batch }),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`주문 상세 조회 실패 (${response.status}): ${body}`);
    }

    const json = await response.json();
    const parsed = productOrdersQueryResponseSchema.parse(json);

    results.push(...parsed.data.map((d) => d.productOrder));
  }

  return results;
}

/**
 * 발송대기 주문 전체 조회 (Step 1 + Step 2 조합)
 */
export async function fetchPendingOrders(): Promise<ProductOrderDetail[]> {
  const changedOrders = await fetchChangedProductOrderIds();
  const productOrderIds = changedOrders.map((o) => o.productOrderId);
  return fetchProductOrderDetails(productOrderIds);
}
```

**설명:**
- 2단계 조회: `last-changed-statuses` → `product-orders/query`
- 429 Rate Limit 시 지수 백오프 (1s → 2s → 4s, 최대 3회)
- 300개 단위 배치 처리

### 5. 내일배송 가능 지역 판별 (`src/lib/naver/regions.ts`)

```typescript
/**
 * 내일배송 가능 지역 판별
 * CLAUDE.md 기준:
 * - 서울: 전체
 * - 인천: 계양/남동/부평/연수구
 * - 경기: 고양/광명/군포/부천/성남/수원/안산/안양시
 */

const NEXT_DAY_ELIGIBLE_AREAS: Record<string, string[] | "ALL"> = {
  서울: "ALL",
  인천: ["계양구", "남동구", "부평구", "연수구"],
  경기: [
    "고양시",
    "광명시",
    "군포시",
    "부천시",
    "성남시",
    "수원시",
    "안산시",
    "안양시",
  ],
};

/**
 * 주소 문자열에서 내일배송 가능 여부를 판별한다.
 * @param address - 전체 주소 문자열 (예: "서울특별시 강남구 역삼동 123-4")
 * @returns 내일배송 가능 여부
 */
export function isNextDayDeliveryEligible(address: string): boolean {
  for (const [region, districts] of Object.entries(NEXT_DAY_ELIGIBLE_AREAS)) {
    if (!address.includes(region)) continue;

    // 서울은 전체 가능
    if (districts === "ALL") return true;

    // 특정 구/시만 가능
    return districts.some((district) => address.includes(district));
  }

  return false;
}
```

### 6. 내일배송 지역 판별 테스트 (`src/lib/naver/regions.test.ts`)

```typescript
import { describe, it, expect } from "vitest";
import { isNextDayDeliveryEligible } from "./regions";

describe("isNextDayDeliveryEligible", () => {
  it("서울 전체 지역은 가능", () => {
    expect(isNextDayDeliveryEligible("서울특별시 강남구 역삼동")).toBe(true);
    expect(isNextDayDeliveryEligible("서울특별시 노원구 상계동")).toBe(true);
  });

  it("인천 지정 구만 가능", () => {
    expect(isNextDayDeliveryEligible("인천광역시 부평구 부평동")).toBe(true);
    expect(isNextDayDeliveryEligible("인천광역시 연수구 연수동")).toBe(true);
  });

  it("인천 미지정 구는 불가", () => {
    expect(isNextDayDeliveryEligible("인천광역시 중구 운서동")).toBe(false);
    expect(isNextDayDeliveryEligible("인천광역시 서구 검단동")).toBe(false);
  });

  it("경기 지정 시만 가능", () => {
    expect(isNextDayDeliveryEligible("경기도 성남시 분당구 서현동")).toBe(true);
    expect(isNextDayDeliveryEligible("경기도 수원시 영통구")).toBe(true);
    expect(isNextDayDeliveryEligible("경기도 고양시 일산동구")).toBe(true);
  });

  it("경기 미지정 시는 불가", () => {
    expect(isNextDayDeliveryEligible("경기도 용인시 수지구")).toBe(false);
    expect(isNextDayDeliveryEligible("경기도 파주시 운정동")).toBe(false);
  });

  it("기타 지역은 불가", () => {
    expect(isNextDayDeliveryEligible("부산광역시 해운대구")).toBe(false);
    expect(isNextDayDeliveryEligible("대전광역시 유성구")).toBe(false);
  });
});
```

### 7. DB 동기화 로직 (`src/lib/naver/sync.ts`)

네이버 API에서 가져온 주문을 로컬 DB에 upsert.

```typescript
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { isNextDayDeliveryEligible } from "./regions";
import { fetchPendingOrders } from "./orders";
import type { ProductOrderDetail } from "./types";

/**
 * 단일 주문을 DB에 upsert (productOrderId 기준 중복 방지)
 */
function upsertOrder(order: ProductOrderDetail): void {
  const address = `${order.shippingAddress.baseAddress} ${order.shippingAddress.detailAddress ?? ""}`.trim();
  const isNextDay = isNextDayDeliveryEligible(address);

  const existing = db
    .select()
    .from(orders)
    .where(eq(orders.productOrderId, order.productOrderId))
    .get();

  if (existing) {
    // 이미 예약 처리된 주문은 업데이트하지 않음
    if (existing.status !== "pending") return;

    db.update(orders)
      .set({
        orderDate: order.orderDate,
        productName: order.productName,
        quantity: order.quantity,
        optionInfo: order.optionManageCode ?? null,
        totalPrice: order.totalPaymentAmount,
        recipientName: order.shippingAddress.name,
        recipientPhone: order.shippingAddress.tel1,
        recipientAddress: address,
        recipientZipCode: order.shippingAddress.zipCode,
        isNextDayEligible: isNextDay,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(orders.productOrderId, order.productOrderId))
      .run();
  } else {
    db.insert(orders)
      .values({
        orderId: order.orderId,
        productOrderId: order.productOrderId,
        orderDate: order.orderDate,
        productName: order.productName,
        quantity: order.quantity,
        optionInfo: order.optionManageCode ?? null,
        totalPrice: order.totalPaymentAmount,
        recipientName: order.shippingAddress.name,
        recipientPhone: order.shippingAddress.tel1,
        recipientAddress: address,
        recipientZipCode: order.shippingAddress.zipCode,
        status: "pending",
        isNextDayEligible: isNextDay,
        selectedDeliveryType: isNextDay ? "nextDay" : "domestic",
      })
      .run();
  }
}

/**
 * 네이버 API에서 발송대기 주문을 조회하고 DB에 동기화
 * @returns 신규 추가 건수, 업데이트 건수
 */
export async function syncOrders(): Promise<{
  total: number;
  created: number;
  updated: number;
  skipped: number;
}> {
  const pendingOrders = await fetchPendingOrders();

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const order of pendingOrders) {
    const existing = db
      .select()
      .from(orders)
      .where(eq(orders.productOrderId, order.productOrderId))
      .get();

    if (existing && existing.status !== "pending") {
      skipped++;
      continue;
    }

    upsertOrder(order);

    if (existing) {
      updated++;
    } else {
      created++;
    }
  }

  return {
    total: pendingOrders.length,
    created,
    updated,
    skipped,
  };
}
```

**설명:**
- `productOrderId` 기준 upsert (중복 방지)
- 이미 예약 처리된 주문(`booking`/`booked`/`failed`/`skipped`)은 건드리지 않음
- 내일배송 가능 지역은 자동 판별하여 `selectedDeliveryType` 기본값 설정

### 8. 주문 DB 쿼리 서비스 (`src/lib/orders.ts`)

API 라우트에서 사용할 주문 조회 서비스.

```typescript
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

/**
 * 전체 주문 목록 조회 (최신순)
 */
export function getOrders(status?: string) {
  const query = db.select().from(orders).orderBy(desc(orders.createdAt));

  if (status) {
    return query.where(eq(orders.status, status)).all();
  }

  return query.all();
}

/**
 * 단일 주문 조회
 */
export function getOrderById(id: number) {
  return db.select().from(orders).where(eq(orders.id, id)).get();
}
```

### 9. 공유 타입 정의 (`src/types/index.ts`)

```typescript
import type { InferSelectModel } from "drizzle-orm";
import type { orders } from "@/lib/db/schema";

/** DB에서 조회된 주문 타입 */
export type Order = InferSelectModel<typeof orders>;

/** 주문 동기화 결과 */
export interface SyncResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
}
```

### 10. 주문 목록 API (`src/app/api/orders/route.ts`)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getOrders } from "@/lib/orders";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status") ?? undefined;
    const orderList = getOrders(status);

    return NextResponse.json({ orders: orderList });
  } catch (error) {
    console.error("주문 목록 조회 실패:", error);
    return NextResponse.json(
      { error: "주문 목록을 조회할 수 없습니다." },
      { status: 500 }
    );
  }
}
```

### 11. 동기화 트리거 API (`src/app/api/orders/sync/route.ts`)

```typescript
import { NextResponse } from "next/server";
import { syncOrders } from "@/lib/naver/sync";

export async function POST() {
  try {
    const result = await syncOrders();

    return NextResponse.json({
      message: "동기화 완료",
      ...result,
    });
  } catch (error) {
    console.error("주문 동기화 실패:", error);

    const message =
      error instanceof Error ? error.message : "알 수 없는 오류";

    return NextResponse.json(
      { error: `주문 동기화에 실패했습니다: ${message}` },
      { status: 500 }
    );
  }
}
```

## 커밋 계획

1. `feat(naver): OAuth 토큰 생성 및 bcrypt 서명 구현` - `auth.ts`, `auth.test.ts`, `types.ts`
2. `feat(naver): 발송대기 주문 조회 서비스 구현` - `orders.ts`, `regions.ts`, `regions.test.ts`
3. `feat(naver): 주문 DB 동기화 로직 구현` - `sync.ts`, `src/lib/orders.ts`
4. `feat(naver): 주문 API 라우트 구현` - `route.ts` (orders, orders/sync), `types/index.ts`

## 테스트 계획

- [x] `generateClientSecretSign` - 동일 입력 일관성, base64 인코딩, 다른 timestamp 구분
- [x] `isNextDayDeliveryEligible` - 서울 전체, 인천 지정구, 경기 지정시, 미지정 지역

테스트 실행: `npx vitest run`

## 체크리스트

- [ ] `docs/conventions.md` 규칙 준수
- [ ] `.env.local`에 민감 정보 하드코딩 없음
- [ ] 타입 안전성 확인 (any 없음, zod로 외부 데이터 파싱)
- [ ] 에러 핸들링 포함 (429 백오프, 토큰 만료 자동 갱신)
- [ ] import 정렬 규칙 준수
- [ ] API 라우트 → lib/ 서비스 함수 → DB 레이어 분리
- [ ] `docs/project-history.md` 업데이트

## project-history.md 추가 내용

```markdown
### Phase 2: 네이버 커머스 API 연동 (#2)
- 완료일: YYYY-MM-DD
- PR: #N
- 주요 커밋:
  - OAuth 2.0 인증 (bcrypt 서명 + 토큰 캐싱)
  - 발송대기 주문 2단계 조회 (변경분 → 상세)
  - 내일배송 가능 지역 자동 판별
  - DB 동기화 (productOrderId 기준 upsert)
  - API 라우트: GET /api/orders, POST /api/orders/sync
```

## 참고 사항

- 네이버 커머스 API 공식 문서(apicenter.commerce.naver.com)에 직접 접근 불가하여 [커뮤니티 소스](https://github.com/commerce-api-naver/commerce-api) 기반으로 스키마 작성
- **첫 API 호출 시 실제 응답을 로깅하여 zod 스키마 필드명을 보정해야 함**
- 토큰 만료 시간이 문서에 명시되지 않아 24시간으로 보수적 가정 (실제 값 확인 후 조정)
