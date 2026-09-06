# fix(dispatch): 내일배송 택배사 코드·가능 지역 변경 반영

## 이슈
- 번호: #79
- 브랜치: `fix/79-nextday-nationwide-cjgls`

## 개요

GS편의점 내일배송의 운영 조건이 두 가지 바뀌었다. 배송사가 CJ대한통운으로 바뀌어 국내택배와 같아졌고, 배송 권역이 수도권 일부에서 전국으로 넓어졌다. 현재 코드는 둘 다 예전 기준으로 굳어 있어, 내일배송 건이 실제와 다른 택배사 코드로 발송처리되고 보낼 수 있는 지역이 UI에서 막혀 있다.

## 사용자와 확정한 방침

| 항목 | 결정 |
|------|------|
| 새 주문 기본 배송 유형 | **국내택배 고정.** 내일배송은 주문 목록에서 직접 고른다 |
| 내일배송 제외 지역 | **제주 + 도서 지역** |
| 이미 쌓인 주문 | **새 기준으로 다시 계산** (발송대기·실패 상태만) |

## 핵심 함정 — 택배사 코드는 코드 상수가 아니라 DB에 있다

`getNextDayDeliveryCode()`는 `settings` 테이블의 `dispatch.nextDayDeliveryCode`를 먼저 읽는다. `DELIVERY_COMPANY_CODES.nextDay` 상수는 저장된 값이 없을 때의 **기본값일 뿐**이다.

로컬과 서버는 별도 DB를 쓴다. 상수만 CJGLS로 바꾸면 양쪽 DB에 저장된 `JMNP`가 그대로 쓰여 조용히 예전대로 발송된다. 실패 로그도 남지 않는다 — 네이버가 유효한 코드로 받아주기 때문이다.

이미 같은 자리에서 한 번 겪은 문제라 `RETIRED_NEXT_DAY_CODES` 정규화 경로가 있다(`DELIVERBOX` 등록). **`JMNP`도 거기에 넣는 것이 이 작업에서 가장 빠뜨리기 쉬우면서 가장 치명적인 한 줄이다.**

이 방식이 통하는 근거는 확인했다. `dispatch.nextDayDeliveryCode`를 읽는 곳은 `settings.ts:157` 하나뿐이고 거기서 `normalizeNextDayDeliveryCode()`를 거친다. 발송 경로(`dispatch-worker.ts`, `api/dispatch/route.ts`)와 설정 조회(`settings.ts:72,104`)는 모두 `getNextDayDeliveryCode()`를 통하므로 우회 경로가 없다. DB 값을 직접 고치는 마이그레이션 없이 조회 시점 교정만으로 충분하다.

## 변경 파일 목록

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `src/lib/naver/delivery-companies.ts` | 수정 | `nextDay` 코드를 CJGLS로, `JMNP`를 폐기 코드로 등록 |
| `src/lib/naver/regions.ts` | 전면 재작성 | 허용 목록 → 제외 목록. 우편번호 + 지명 판별 |
| `src/lib/naver/regions.test.ts` | 전면 재작성 | 새 판별 기준 테스트 |
| `src/lib/naver/sync.ts` | 수정 | 신규 주문 기본 유형 `domestic` 고정, 우편번호 전달 |
| `src/lib/db/migrations.ts` | 신규 생성 | 기존 발송대기·실패 주문 재계산 (1회) |
| `src/lib/db/index.ts` | 수정 | 마이그레이션 호출 |
| `src/types/index.ts` | 수정 | `nextDayDeliveryCode` 주석 갱신 |
| `src/components/settings/DispatchSettingsTab.tsx` | 수정 | placeholder·설명문 갱신 |
| `src/lib/dispatch-worker.test.ts` | 수정 | JMNP 목값 → CJGLS |
| `src/lib/naver/dispatch.test.ts` | 수정 | JMNP 픽스처 → CJGLS |
| `README.md` | 수정 | 내일배송 가능 지역 섹션 갱신 |
| `CLAUDE.md` | 수정 | 가능 지역·택배사 코드 설명 갱신 |
| `docs/project-history.md` | 수정 | 변경 기록 추가 |

건드리지 않는 것: `dispatch-worker.ts`, `api/dispatch/route.ts`의 분기. 두 코드 값이 같아졌지만 하나는 설정값이고 하나는 상수라 의미가 다르다. 다시 갈라질 수 있으므로 분기는 유지한다.

---

## 구현 상세

### 1. 택배사 코드 교체 + 옛 코드 폐기 등록

**파일:** `src/lib/naver/delivery-companies.ts`

**Before:**
```typescript
/** 택배 유형별 택배사 코드 */
export const DELIVERY_COMPANY_CODES = {
  /** CJ대한통운 — GS편의점택배(국내택배)의 실제 배송사 */
  domestic: "CJGLS",
  /** 딜리박스 — GS편의점 내일배송의 실제 배송사 */
  nextDay: "JMNP",
} as const;

/**
 * 폐기된 내일배송 코드.
 *
 * 실제 코드를 확인하기 전 자리표시자로 넣어둔 값이라 네이버가 받아주지 않는다.
 * DB(settings)에 이 값이 남아 있으면 기본값으로 되돌린다 — 로컬·서버 DB가
 * 따로 있어 한쪽만 고치면 조용히 다시 실패한다.
 */
const RETIRED_NEXT_DAY_CODES: ReadonlySet<string> = new Set(["DELIVERBOX"]);
```

**After:**
```typescript
/** 택배 유형별 택배사 코드 */
export const DELIVERY_COMPANY_CODES = {
  /** CJ대한통운 — GS편의점택배(국내택배)의 실제 배송사 */
  domestic: "CJGLS",
  /**
   * CJ대한통운 — 내일배송의 실제 배송사.
   *
   * 2026-09 배송사 변경으로 국내택배와 같은 값이 됐다. 값이 같아도 상수는
   * 나눠 둔다 — 내일배송 쪽은 설정으로 덮어쓸 수 있는 값이고, 다시 갈라질
   * 여지가 있다.
   */
  nextDay: "CJGLS",
} as const;

/**
 * 폐기된 내일배송 코드.
 *
 * DB(settings)에 이 값들이 남아 있으면 기본값으로 되돌린다. 로컬·서버 DB가
 * 따로 있어 한쪽만 고치면 조용히 옛 코드로 계속 발송된다.
 *
 * - DELIVERBOX: 실제 코드를 확인하기 전 넣어둔 자리표시자. 네이버가 거절한다.
 * - JMNP: 딜리박스. 2026-09 배송사 변경 전까지 쓰던 값. 네이버가 받아주기
 *   때문에 남아 있어도 에러가 나지 않고, 구매자에게 추적되지 않는 운송장이
 *   전달되는 것으로만 드러난다.
 */
const RETIRED_NEXT_DAY_CODES: ReadonlySet<string> = new Set([
  "DELIVERBOX",
  "JMNP",
]);
```

**설명:** `normalizeNextDayDeliveryCode()`는 그대로 두면 된다 — 폐기 집합에 값을 넣기만 하면 로컬·서버 양쪽에서 조회 시점에 CJGLS로 교정된다. DB 데이터를 손대는 마이그레이션이 필요 없다.

---

### 2. 지역 판별을 허용 목록 → 제외 목록으로 전환

**파일:** `src/lib/naver/regions.ts` (전면 재작성)

```typescript
/**
 * 내일배송 가능 지역 판별.
 *
 * 2026-09 권역 확대로 전국이 열렸다. 이제 판별의 역할은 "어디가 되는가"가
 * 아니라 "어디가 안 되는가"다 — 제주와 배로 들어가는 섬만 걸러낸다.
 *
 * 이 판별은 UI 힌트다. 실제로 GS택배가 받아주는지는 예약 시점에만 확정된다.
 * 과하게 막으면 보낼 수 있는 곳을 고르지 못하게 되므로, 확실한 곳만 적는다.
 */

/** 제주특별자치도 우편번호 범위 (제주시·서귀포시 전역) */
const JEJU_ZIP_MIN = 63000;
const JEJU_ZIP_MAX = 63644;

/**
 * 제주 주소 키워드 — 우편번호가 비었거나 5자리 형식이 아닐 때의 보조 판정.
 * 추자도·우도 등 제주 부속 도서도 이 범위에 함께 걸린다.
 */
const JEJU_ADDRESS_KEYWORDS = ["제주특별자치도", "제주시", "서귀포시"];

/**
 * 배로 들어가는 지역의 주소 키워드.
 *
 * 완전한 목록이 아니다. 예약이 거절된 지역이 나오면 여기에 추가한다.
 * 반대로 다리로 이어져 육로 배송이 되는 곳(강화도·영흥도·거제도 등)은
 * 넣지 않는다.
 *
 * 군 단위로 적은 곳은 관할 전역이 섬인 곳이고, 나머지는 육지 지명과
 * 겹치지 않는 고유 섬 이름만 골랐다. 예를 들어 "삼산면"(여수 거문도)은
 * 해남·영암 등 육지에도 같은 이름이 있어 지명 대신 "거문도"로 적는다.
 */
const ISLAND_ADDRESS_KEYWORDS = [
  // 경북 울릉군 — 관할 전역이 섬
  "울릉군",
  // 전남 신안군 — 관할 전역이 섬
  "신안군",
  // 인천 옹진군 — 영흥면만 육로로 이어져 예외
  "백령면",
  "대청면",
  "연평면",
  "덕적면",
  "자월면",
  "북도면",
  // 고유 섬 이름
  "거문도",
  "홍도",
  "가거도",
  "욕지도",
  "사량도",
  "한산도",
];

/** 우편번호 문자열을 5자리 숫자로 정규화 (하이픈·공백 허용) */
function parseZipCode(zipCode: string | null | undefined): number | null {
  if (!zipCode) return null;
  const digits = zipCode.replace(/\D/g, "");
  if (digits.length !== 5) return null;
  return Number(digits);
}

/** 제주 여부 — 우편번호를 우선 보고, 없으면 주소 문자열로 판정 */
function isJeju(address: string, zipCode: string | null | undefined): boolean {
  const zip = parseZipCode(zipCode);
  if (zip !== null) {
    return zip >= JEJU_ZIP_MIN && zip <= JEJU_ZIP_MAX;
  }
  return JEJU_ADDRESS_KEYWORDS.some((keyword) => address.includes(keyword));
}

/** 배로 들어가는 지역 여부 */
function isIsland(address: string): boolean {
  return ISLAND_ADDRESS_KEYWORDS.some((keyword) => address.includes(keyword));
}

/**
 * 주소로 내일배송 가능 여부를 판별한다.
 *
 * @param address - 전체 주소 문자열 (예: "서울특별시 강남구 역삼동 123-4")
 * @param zipCode - 우편번호. 제주 판별의 1차 근거. 없으면 주소로 판정한다
 */
export function isNextDayDeliveryEligible(
  address: string,
  zipCode?: string | null,
): boolean {
  return !isJeju(address, zipCode) && !isIsland(address);
}
```

**설명:**

- 우편번호를 1차 근거로 두는 이유는 주소 문자열보다 흔들림이 적어서다. `"제주"` 부분 문자열로만 판정하면 다른 지역의 `제주로` 같은 도로명에 걸릴 수 있다.
- 우편번호가 없거나 형식이 다를 때만 주소로 떨어진다. `recipientZipCode`는 스키마상 `notNull`이지만, 마이그레이션에서 옛 데이터를 다룰 때 빈 문자열이 있을 수 있어 방어한다.
- 두 번째 인자를 선택 인자로 둔 것은 호출부가 사실상 둘뿐이고(sync·마이그레이션), 우편번호 없이도 동작해야 하기 때문이다.

---

### 3. 지역 판별 테스트 재작성

**파일:** `src/lib/naver/regions.test.ts` (전면 재작성)

기존 테스트는 전부 옛 허용 목록 전제라 통째로 갈아엎는다. 특히 `"부산광역시 해운대구" → false`, `"경기도 용인시 수지구" → false` 같은 단언은 이제 정반대가 된다.

```typescript
import { describe, it, expect } from "vitest";

import { isNextDayDeliveryEligible } from "./regions";

describe("isNextDayDeliveryEligible", () => {
  it("육지는 전국 어디든 가능", () => {
    expect(isNextDayDeliveryEligible("서울특별시 강남구 역삼동", "06234")).toBe(true);
    expect(isNextDayDeliveryEligible("부산광역시 해운대구 우동", "48094")).toBe(true);
    expect(isNextDayDeliveryEligible("강원특별자치도 속초시 조양동", "24825")).toBe(true);
    expect(isNextDayDeliveryEligible("전라남도 목포시 상동", "58697")).toBe(true);
  });

  it("예전에 막혀 있던 수도권 지역도 이제 가능", () => {
    expect(isNextDayDeliveryEligible("경기도 용인시 수지구", "16827")).toBe(true);
    expect(isNextDayDeliveryEligible("인천광역시 중구 운서동", "22382")).toBe(true);
  });

  it("제주는 우편번호로 걸러낸다", () => {
    expect(isNextDayDeliveryEligible("제주특별자치도 제주시 연동", "63122")).toBe(false);
    expect(isNextDayDeliveryEligible("제주특별자치도 서귀포시 중문동", "63535")).toBe(false);
  });

  it("우편번호가 없으면 제주를 주소로 걸러낸다", () => {
    expect(isNextDayDeliveryEligible("제주특별자치도 제주시 연동")).toBe(false);
    expect(isNextDayDeliveryEligible("제주특별자치도 서귀포시 중문동", "")).toBe(false);
  });

  it("우편번호가 있으면 주소에 '제주'가 들어가도 육지로 본다", () => {
    // 다른 지역의 도로명에 '제주'가 섞여도 우편번호가 우선한다
    expect(isNextDayDeliveryEligible("경기도 성남시 분당구 제주로 12", "13561")).toBe(true);
  });

  it("배로 들어가는 섬은 불가", () => {
    expect(isNextDayDeliveryEligible("경상북도 울릉군 울릉읍 도동리", "40201")).toBe(false);
    expect(isNextDayDeliveryEligible("인천광역시 옹진군 백령면 진촌리", "23103")).toBe(false);
    expect(isNextDayDeliveryEligible("전라남도 신안군 흑산면 예리", "58762")).toBe(false);
  });

  it("다리로 이어진 섬은 가능", () => {
    expect(isNextDayDeliveryEligible("인천광역시 강화군 강화읍 관청리", "23037")).toBe(true);
    expect(isNextDayDeliveryEligible("인천광역시 옹진군 영흥면 내리", "23139")).toBe(true);
    expect(isNextDayDeliveryEligible("경상남도 거제시 고현동", "53243")).toBe(true);
  });

  it("우편번호에 하이픈이 섞여도 인식한다", () => {
    expect(isNextDayDeliveryEligible("제주특별자치도 제주시 연동", "631-22")).toBe(false);
  });
});
```

> 구현 시 확인할 것: `"인천광역시 옹진군 영흥면 내리"`가 `true`가 되려면 `ISLAND_ADDRESS_KEYWORDS`에 `"옹진군"`이 없어야 한다. 위 목록은 면 단위로 적어 이 조건을 만족한다.

---

### 4. 신규 주문 기본 배송 유형을 국내택배로 고정

**파일:** `src/lib/naver/sync.ts`

**Before (18~19행):**
```typescript
  const fullAddress = `${baseAddress} ${detailedAddress ?? ""}`.trim();
  const isNextDay = isNextDayDeliveryEligible(fullAddress);
```

**After:**
```typescript
  const fullAddress = `${baseAddress} ${detailedAddress ?? ""}`.trim();
  const isNextDay = isNextDayDeliveryEligible(
    fullAddress,
    order.shippingAddress.zipCode,
  );
```

**Before (56~58행, insert 경로):**
```typescript
        status: "pending",
        isNextDayEligible: isNextDay,
        selectedDeliveryType: isNextDay ? "nextDay" : "domestic",
```

**After:**
```typescript
        status: "pending",
        isNextDayEligible: isNextDay,
        // 전국이 열려 대부분이 내일배송 가능이 된다. 자동으로 태우면 요금 판단이
        // 사라지므로 기본은 국내택배로 두고, 내일배송은 목록에서 직접 고른다.
        selectedDeliveryType: "domestic",
```

**설명:** update 경로(21~39행)는 그대로 둔다. `isNextDayEligible`만 갱신하고 `selectedDeliveryType`은 건드리지 않는다 — 여기에 기본값을 다시 쓰면 사용자가 목록에서 고른 내일배송을 2분마다 도는 동기화가 국내택배로 되돌린다.

---

### 5. 기존 주문 1회 재계산 마이그레이션

**파일:** `src/lib/db/migrations.ts` (신규 생성)

```typescript
import type BetterSqlite3 from "better-sqlite3";

import { isNextDayDeliveryEligible } from "@/lib/naver/regions";

/**
 * 1회성 데이터 마이그레이션.
 *
 * 실행 여부는 settings 테이블의 마커 행으로 판단한다. drizzle 인스턴스가
 * 만들어지기 전에 도는 자리라 raw sqlite로 다룬다 — settings.ts를 부르면
 * db/index.ts와 순환 참조가 된다.
 */

/** 마이그레이션 완료 마커 키 */
const MIGRATION_KEY = "migration.nextDayNationwide";

/** 테이블 존재 여부 */
function hasTable(sqlite: BetterSqlite3.Database, name: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return row !== undefined;
}

/**
 * 내일배송 전국 확대 반영 (2026-09).
 *
 * 아직 예약 전인 주문만 새 기준으로 다시 계산한다.
 * - is_next_day_eligible: 새 지역 판별로 재계산
 * - selected_delivery_type: 새 기본값인 국내택배로 되돌림
 *
 * 예약이 끝난 주문(booked·dispatched 등)은 건드리지 않는다. 이미 그 유형으로
 * GS에 예약이 들어가 있어 값을 바꾸면 발송처리 택배사 코드가 어긋난다.
 * 방문수거(visit)도 별개 흐름이라 제외한다.
 */
export function migrateNextDayNationwide(sqlite: BetterSqlite3.Database): void {
  // 테이블은 drizzle-kit push로 만든다 — 런타임에 스키마를 세우는 코드가 없어서
  // 새 DB 첫 기동 때는 아직 없을 수 있다. 그 경우 재계산할 주문도 없으므로
  // 조용히 건너뛴다. (PRAGMA와 달리 SELECT는 테이블이 없으면 예외를 던진다)
  if (!hasTable(sqlite, "settings") || !hasTable(sqlite, "orders")) return;

  const done = sqlite
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(MIGRATION_KEY) as { value: string } | undefined;
  if (done) return;

  const targets = sqlite
    .prepare(
      `SELECT id, recipient_address, recipient_address_detail, recipient_zip_code
         FROM orders
        WHERE status IN ('pending', 'failed')
          AND selected_delivery_type != 'visit'`,
    )
    .all() as Array<{
    id: number;
    recipient_address: string;
    recipient_address_detail: string | null;
    recipient_zip_code: string | null;
  }>;

  const update = sqlite.prepare(
    `UPDATE orders
        SET is_next_day_eligible = ?,
            selected_delivery_type = 'domestic',
            updated_at = ?
      WHERE id = ?`,
  );
  const now = new Date().toISOString();

  const run = sqlite.transaction(() => {
    for (const row of targets) {
      const fullAddress =
        `${row.recipient_address} ${row.recipient_address_detail ?? ""}`.trim();
      const eligible = isNextDayDeliveryEligible(
        fullAddress,
        row.recipient_zip_code,
      );
      update.run(eligible ? 1 : 0, now, row.id);
    }
    sqlite
      .prepare(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
      )
      .run(MIGRATION_KEY, now, now);
  });

  run();

  if (targets.length > 0) {
    console.log(
      `[migration] 내일배송 전국 확대 반영 — 발송대기·실패 주문 ${targets.length}건 재계산`,
    );
  }
}
```

**파일:** `src/lib/db/index.ts`

**Before (44~49행):**
```typescript
addColumnIfNotExists("orders", "tracking_number", "TEXT");
addColumnIfNotExists("orders", "dispatch_status", "TEXT");
addColumnIfNotExists("orders", "dispatched_at", "TEXT");
addColumnIfNotExists("orders", "booked_at", "TEXT");

export const db = drizzle(sqlite, { schema });
```

**After:**
```typescript
addColumnIfNotExists("orders", "tracking_number", "TEXT");
addColumnIfNotExists("orders", "dispatch_status", "TEXT");
addColumnIfNotExists("orders", "dispatched_at", "TEXT");
addColumnIfNotExists("orders", "booked_at", "TEXT");

// 데이터 마이그레이션은 스키마 보정 뒤에 돈다. 각각 마커로 1회만 실행된다.
migrateNextDayNationwide(sqlite);

export const db = drizzle(sqlite, { schema });
```

import를 파일 상단에 추가한다:
```typescript
import { migrateNextDayNationwide } from "./migrations";
```

**설명:**

- 로컬과 서버가 별도 DB이므로 각자 첫 기동 시 한 번씩 돈다. 배포하면 서버 쪽도 자동으로 반영된다.
- **테이블 존재 확인이 필수다.** 이 프로젝트는 런타임에 스키마를 세우지 않는다 — `drizzle-kit`은 devDependency일 뿐이고 `migrate()` 호출이 코드에도 npm script에도 없어서, 테이블은 `npx drizzle-kit push`를 손으로 돌려 만든다. 기존 `addColumnIfNotExists`가 이 상황에서 안 터지는 건 `PRAGMA table_info`가 없는 테이블에도 빈 배열을 주기 때문이고, `SELECT`는 다르다. 가드가 없으면 새 DB 첫 기동에서 앱 전체가 죽는다.
- 트랜잭션으로 묶어, 중간에 실패하면 마커도 남지 않아 다음 기동에서 다시 시도한다.

> 구현 시 확인할 것: `migrations.ts`가 `@/lib/naver/regions`를 부르는데 `regions.ts`는 import가 하나도 없는 순수 모듈이다. 순환 참조가 생기지 않는다.

---

### 6. 설정 화면·타입 주석 갱신

**파일:** `src/types/index.ts` (109행)

**Before:**
```typescript
  /** 내일배송 택배사 코드 (기본값 JMNP — 딜리박스) */
  nextDayDeliveryCode: string;
```

**After:**
```typescript
  /** 내일배송 택배사 코드 (기본값 CJGLS — CJ대한통운) */
  nextDayDeliveryCode: string;
```

**파일:** `src/components/settings/DispatchSettingsTab.tsx` (61~75행)

**Before:**
```tsx
          placeholder="JMNP"
        />
        <p className="text-xs text-muted-foreground">
          내일배송 배송사 코드 (네이버 API 기준). 기본값 JMNP는 딜리박스이며,
          발송처리 후 네이버 상태를 다시 조회해 실제 반영을 확인합니다.
        </p>
```

**After:**
```tsx
          placeholder="CJGLS"
        />
        <p className="text-xs text-muted-foreground">
          내일배송 배송사 코드 (네이버 API 기준). 기본값 CJGLS는 CJ대한통운이며,
          발송처리 후 네이버 상태를 다시 조회해 실제 반영을 확인합니다.
        </p>
```

---

### 7. 기존 테스트의 옛 코드 값 교체

**파일:** `src/lib/dispatch-worker.test.ts`

세 자리를 바꾼다.

| 행 | Before | After |
|----|--------|-------|
| 10 | `getNextDayDeliveryCode: vi.fn(() => "JMNP")` | `getNextDayDeliveryCode: vi.fn(() => "CJGLS")` |
| 86 | `mocks.getNextDayDeliveryCode.mockReturnValue("JMNP")` | `mocks.getNextDayDeliveryCode.mockReturnValue("CJGLS")` |
| 147 | `expect.objectContaining({ deliveryCompanyCode: "JMNP" })` | `expect.objectContaining({ deliveryCompanyCode: "CJGLS" })` |

147행이 있는 테스트 이름 `"nextDay 그룹은 내일배송 택배사 코드로 발송한다"`는 그대로 둔다. 값이 국내택배와 같아졌어도 이 테스트가 지키는 것은 "설정에서 읽은 값을 쓴다"는 경로다.

**파일:** `src/lib/naver/dispatch.test.ts`

| 행 | Before | After |
|----|--------|-------|
| 17 | `deliveryCompanyCode: "JMNP"` | `deliveryCompanyCode: "CJGLS"` |
| 74 | `expect(result.error).toContain("JMNP")` | `expect(result.error).toContain("CJGLS")` |

---

### 8. 문서 갱신

**파일:** `README.md` (106~112행)

**Before:**
```markdown
## 내일배송 가능 지역

```
서울특별시 전체
인천광역시: 계양구, 남동구, 부평구, 연수구
경기도: 고양시, 광명시, 군포시, 부천시, 성남시, 수원시, 안산시, 안양시
```
```

**After:**
```markdown
## 내일배송 가능 지역

전국. 다음 지역만 제외합니다.

```
제주특별자치도 전역 (우편번호 63000~63644)
배로 들어가는 섬 — 울릉군, 신안군, 옹진군 도서(영흥면 제외) 등
```

다리로 이어져 육로 배송이 되는 섬(강화도·영흥도·거제도 등)은 가능합니다.
제외 지역 목록은 `src/lib/naver/regions.ts`에 있으며, 예약이 거절된 지역이
나오면 목록에 추가합니다.
```

**파일:** `CLAUDE.md` (138행 및 21행)

138행 Before:
```markdown
- 내일배송 가능 지역: 서울 전체, 인천(계양/남동/부평/연수구), 경기(고양/광명/군포/부천/성남/수원/안산/안양시)
```

138행 After:
```markdown
- 내일배송 가능 지역: 전국. 제주와 배로 들어가는 섬만 제외 (`src/lib/naver/regions.ts`)
```

같은 절의 택배사 코드 줄도 함께 손본다.

Before:
```markdown
- 택배사 코드: `CJGLS` (CJ대한통운 — GS편의점택배 실제 배송사)
```

After:
```markdown
- 택배사 코드: 국내택배·내일배송 모두 `CJGLS` (CJ대한통운). 내일배송 쪽은
  DB(settings)에 저장된 값이 우선하므로, 코드를 바꿀 때 옛 값을
  `RETIRED_NEXT_DAY_CODES`에 등록해야 로컬·서버 양쪽이 교정된다
```

21행은 "(내일배송 가능 지역 자동 판별)"을 "(제주·도서 지역 자동 제외)"로 바꾼다. README 29행의 같은 문구도 함께 맞춘다.

**파일:** `docs/project-history.md`

이 문서는 시간순으로 **파일 맨 끝에 덧붙인다**. 헤더 형식은 직전 항목들과 맞춘다
(`## <날짜> — <제목> (#<이슈>)`).

```markdown
## 2026-09-06 — 내일배송 전국 확대·배송사 변경 반영 (#79)

GS편의점 내일배송의 운영 조건이 두 가지 바뀌어 코드 전제가 어긋난 것을 맞췄다.

### 배송사 변경
- 내일배송의 실제 배송사가 CJ대한통운으로 바뀌어 국내택배와 같은 코드가 됨
- 이 코드는 상수가 아니라 DB(settings) 저장값이 우선하는 구조다. 로컬·서버가
  별도 DB라 상수만 고치면 저장된 옛 값으로 계속 발송되고, 네이버가 그 코드를
  받아주기 때문에 에러도 남지 않는다
- 옛 값을 폐기 코드 집합에 등록해 조회 시점에 양쪽이 교정되게 함

### 권역 확대
- 수도권 일부(서울 전체, 인천 4개 구, 경기 8개 시)에서 전국으로 확대
- 지역 판별을 허용 목록에서 제외 목록으로 뒤집음 — 제주는 우편번호 범위로,
  배로 들어가는 섬은 지명 목록으로 판별
- 다리로 이어져 육로 배송이 되는 섬(강화도·영흥도·거제도)은 가능으로 둠

### 기본값 판단
- 전국이 열려도 신규 주문 기본은 국내택배 유지. 자동으로 내일배송에 태우면
  요금 판단이 사라져, 내일배송은 목록에서 직접 고르게 함
- 이미 쌓인 발송대기·실패 주문은 1회 마이그레이션으로 재계산. 예약이 끝난
  주문은 GS 예약과 택배사 코드가 어긋나므로 건드리지 않음

### 산출물
- 신규: `lib/db/migrations.ts`
- `lib/naver/regions.ts` 전면 재작성 + 테스트 재작성 (8건)
```

---

## 커밋 계획

1. `fix(dispatch): 내일배송 택배사 코드를 CJ대한통운으로 교체`
   - `src/lib/naver/delivery-companies.ts`
   - `src/types/index.ts`
   - `src/components/settings/DispatchSettingsTab.tsx`
   - `src/lib/dispatch-worker.test.ts`
   - `src/lib/naver/dispatch.test.ts`

2. `fix(naver): 내일배송 가능 지역을 전국으로 확대하고 제주·도서만 제외`
   - `src/lib/naver/regions.ts`
   - `src/lib/naver/regions.test.ts`
   - `src/lib/naver/sync.ts`

3. `fix(db): 기존 발송대기 주문의 내일배송 판별을 새 기준으로 재계산`
   - `src/lib/db/migrations.ts`
   - `src/lib/db/index.ts`

4. `docs: 내일배송 전국 확대·배송사 변경 반영`
   - `README.md`
   - `CLAUDE.md`
   - `docs/project-history.md`

---

## 테스트 계획

### 자동 테스트
- [ ] `npx vitest run src/lib/naver/regions.test.ts` — 새 판별 기준 전체 통과
- [ ] `npx vitest run src/lib/dispatch-worker.test.ts` — 택배사 코드 교체 후 통과
- [ ] `npx vitest run src/lib/naver/dispatch.test.ts` — 택배사 코드 교체 후 통과
- [ ] `npx vitest run` — 전체 통과 (regions 변경이 다른 테스트를 깨지 않는지)
- [ ] `npx tsc --noEmit` — 타입 통과 (`isNextDayDeliveryEligible` 시그니처 변경 여파 확인)
- [ ] `npm run lint`

### 마이그레이션 가드 확인
- [ ] 빈 DB(테이블 없는 상태)에서 앱 기동 시 예외 없이 뜨는지 — `mv data/smart-ship.db /tmp/` 후 기동, 확인 뒤 원복

### 수동 확인 (로컬)
- [ ] 앱 기동 시 콘솔에 `[migration] 내일배송 전국 확대 반영` 1회 출력, 재기동 시 미출력
- [ ] 마이그레이션 후 발송대기 주문의 "내일배송" 배지가 제주·도서 외 전부 "가능"
- [ ] 예약 완료(booked)·발송처리 완료 주문의 배송 유형이 그대로 남아 있는지
- [ ] 주문 목록에서 지방 주소(예: 부산) 주문의 내일배송 선택이 활성화되는지
- [ ] 제주 주소 주문의 내일배송 선택이 비활성 + "내일배송 (불가 지역)" 표시
- [ ] 설정 → 발송처리 탭의 택배사 코드 입력란이 `CJGLS`로 보이는지 (기존 저장값 `JMNP`가 교정되는지)

### 배포 후 확인 (서버)
- [ ] PM2 로그에 마이그레이션 1회 실행 기록
- [ ] 내일배송 건 발송처리 후 네이버 주문 상세의 택배사가 CJ대한통운인지
- [ ] 발송처리된 운송장이 CJ대한통운 조회로 추적되는지

---

## 체크리스트

- [ ] `docs/conventions.md` 규칙 준수 (네이밍, 커밋 컨벤션, 레이어 분리)
- [ ] `.env.local`에 민감 정보 하드코딩 없음 — 이번 변경은 env를 건드리지 않음
- [ ] 타입 안전성 확인 (`any` 없음, `better-sqlite3` raw 쿼리 결과에 명시 타입)
- [ ] 에러 핸들링 — 마이그레이션은 트랜잭션으로 묶어 부분 적용 방지
- [ ] `docs/project-history.md` 기록
- [ ] 이슈·PR 본문에 개인/민감 정보 없음

---

## 남겨두는 것 (별도 이슈 후보)

**설정의 `booking.defaultDeliveryType`이 어디에도 쓰이지 않는다.** 설정 화면에서 저장은 되지만 `sync.ts`가 읽지 않아 아무 효과가 없다. 이번 변경으로 신규 주문 기본값을 `domestic`으로 고정하면서 이 항목과의 어긋남이 더 뚜렷해진다. 설정을 실제로 연결하거나 항목을 없애는 판단이 필요하지만, 이번 작업 범위 밖이다.

**"내일배송 가능/불가" 배지 컬럼의 정보량이 낮아진다.** 전국이 열려 거의 모든 행이 "가능"이 된다. 제외 지역일 때만 표시하는 식으로 줄일 여지가 있으나, 목록 레이아웃 변경이라 별도로 다룬다.

**도서 지역 목록의 완전성.** 실제로 GS택배가 어디까지 받는지는 예약 시점에만 확정된다. 거절 사례가 쌓이면 목록을 보강하거나, 예약 실패를 자동으로 목록에 반영하는 경로를 검토한다.
