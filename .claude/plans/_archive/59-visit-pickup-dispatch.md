# feat(dispatch): 방문택배 자동 발송처리 (폴링 + 수령인 매칭)

## 이슈
- 번호: #59
- 브랜치: `feat/59-visit-pickup-dispatch`
- ADR: [docs/adr/0001-visit-pickup-dispatch.md](../../docs/adr/0001-visit-pickup-dispatch.md)

## 개요

방문택배도 일반택배처럼 폴링 기반으로 자동 발송 처리한다.
사용자는 결제만 하면 되고, 그 다음은 dispatch-worker가 알아서 처리.

### 현재 흐름 vs After

```
[현재]                                      [After]
사용자 N건 선택                              사용자 N건 선택
  ↓                                          ↓
폼 자동 입력 (Playwright)                    폼 자동 입력 (Playwright)
  ↓                                          ↓
사용자가 직접 결제                            사용자가 직접 결제
  ↓                                          ↓ (시스템 인지 없음)
**여기서 종료** — status=booking 영구        dispatch-worker 폴링 (2분 간격)
                                              ├ GS 예약list 방문 행 발견
                                              ├ 상세페이지 파싱
                                              ├ (zip+끝4) 매칭
                                              ├ 예약번호/운송장 DB 저장
                                              └ status=booked → 일반 발송처리 합류
```

## 핵심 결정 (ADR-0001 참조)

1. **트리거**: 폴링만 (사용자 추가 액션 0)
2. **매칭 키**: (우편번호, 전화 끝4자리)

## 변경 파일 목록

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `src/lib/db/schema.ts` | 수정 | `selectedDeliveryType` enum에 `"visit"` 추가 |
| `src/lib/gs-delivery/types.ts` | 수정 | `VisitDispatchInfo` 타입 추가 (스크래퍼 결과) |
| `src/lib/gs-delivery/selectors.ts` | 수정 | 방문 상세페이지 URL + 파서 정규식 상수 |
| `src/lib/gs-delivery/scrape-visit-pickup.ts` | 신규 | 방문 예약list + 상세페이지 스크래퍼 |
| `src/lib/orders.ts` | 수정 | `getBookingVisitPickupGroups`, `applyVisitDispatchInfo` 추가 |
| `src/lib/dispatch-worker.ts` | 수정 | 방문택배 분기 처리 추가 |
| `src/app/api/orders/book-visit/route.ts` | 수정 | `selectedDeliveryType="visit"` 마킹 |
| `src/lib/sync-to-server.ts` | 수정 | 방문택배 booked 동기화 시 deliveryType 전달 |
| `src/app/api/internal/booking-result/route.ts` | 수정 | 방문택배 케이스 처리 |
| `src/lib/gs-delivery/__tests__/scrape-visit-pickup.test.ts` | 신규 | HTML 파서 + 매칭 단위 테스트 |

총 10개 파일 (신규 2개 + 수정 8개).

## 구현 상세

### 1. Schema 변경 (`src/lib/db/schema.ts`)

```typescript
selectedDeliveryType: text("selected_delivery_type", {
  enum: ["domestic", "nextDay", "visit"],  // ← "visit" 추가
})
  .notNull()
  .default("domestic"),
```

마이그레이션: SQLite는 enum이 CHECK 제약으로 매핑됨. 기존 데이터는 영향 없음
(domestic/nextDay만 들어있던 컬럼에 신규 값만 추가). better-sqlite3 + drizzle-kit이
자동 처리. `npm run db:push` 또는 부팅 시 자동 마이그레이션 (현재 프로젝트 방식 확인 필요).

### 2. 타입 추가 (`src/lib/gs-delivery/types.ts`)

```typescript
/** 방문택배 상세페이지에서 추출한 수령인-운송장 매핑 1건 */
export interface VisitRecipientLine {
  /** 우편번호 (5자리) */
  zipCode: string;
  /** 전화번호 끝 4자리 */
  phoneLast4: string;
  /** 운송장번호 (unmasked) */
  trackingNo: string;
}

/** GS 예약list의 방문 행 + 상세페이지 파싱 결과 */
export interface VisitDispatchInfo {
  /** GS 예약번호 (예: "12148215251") */
  reservationNo: string;
  /** 상세페이지의 수신정보 블록들 */
  recipients: VisitRecipientLine[];
}
```

### 3. URL/상수 추가 (`src/lib/gs-delivery/selectors.ts`)

```typescript
export const GS_URLS = {
  // 기존 + 추가
  VISIT_DETAIL: "https://www.cvsnet.co.kr/my-page/reservation/visit/view.do",
} as const;
```

상세페이지 URL 형식: `{VISIT_DETAIL}?detailsKey={reservationNo}` (GET 가능 여부는
실제 fetch 시도해서 확인. POST/AJAX면 onclick 핸들러 분석 필요).

### 4. 스크래퍼 신설 (`src/lib/gs-delivery/scrape-visit-pickup.ts`)

기존 `scrape-tracking.ts` 와 같은 패턴 (HTTP fetch + Cookie 헤더).

```typescript
/**
 * GS 예약list에서 "구분=방문" 행을 찾고, 각 예약의 상세페이지에서
 * 수령인 매핑을 추출한다.
 *
 * @param knownReservationNos  로컬 DB에 이미 매칭된 방문 예약번호 (재처리 방지)
 * @returns 신규 발견된 방문 예약들의 매핑 정보
 */
export async function scrapeVisitPickup(
  knownReservationNos: string[],
): Promise<VisitDispatchInfo[]>;
```

내부 흐름:
1. `GS_URLS.RESERVATION_LIST` HTTP fetch (기존 scrape-tracking과 동일 쿠키 사용)
2. tbody 파싱하면서 4번째 셀 텍스트가 "방문" 인 행만 필터
3. 3번째 셀의 예약번호 추출 (`<a class="bookingNum">` 안 텍스트)
4. `knownReservationNos`에 없는 신규 예약번호 후보 수집
5. 각 신규 예약번호에 대해 상세페이지 fetch → `parseVisitDetailPage(html)` 호출
6. 결과 반환

`parseVisitDetailPage(html)` 내부:
- `<div class="delMInfo">` 블록 단위로 분할
- 각 블록에서 정규식:
  - 우편번호: `/\[(\d{5})\]/`
  - 전화 끝4: `/010-\*+-(\d{4})/`
  - 운송장: `/<a[^>]*class="num"[^>]*>(\d{8,})<\/a>/`
- 세 값이 모두 추출되면 `VisitRecipientLine` 1건 추가

### 5. orders.ts 추가 함수

```typescript
/** booking 상태이면서 방문택배인 그룹 조회 (orderId 기준 그룹화) */
export function getBookingVisitPickupGroups(): VisitPickupGroup[];

/**
 * 방문택배 스크래핑 결과를 로컬 그룹에 매핑 적용.
 *
 * (recipientZipCode, recipientPhone 끝4자리) 키로 매칭.
 * 매칭된 그룹: bookingReservationNo + trackingNumber 저장 + status=booked.
 * 매칭 안 된 그룹: 변경 없음 (다음 폴링에서 재시도).
 *
 * @returns 매칭/미매칭 통계
 */
export function applyVisitDispatchInfo(
  infos: VisitDispatchInfo[],
): { matched: number; unmatched: number; reservations: string[] };
```

매칭 키 정규화:
- zipCode: trim, 5자리 보장
- phoneLast4: 정규식으로 끝 4자리만 추출 (`/(\d{4})$/`)

매칭 알고리즘 (in-memory):
1. 모든 booking 방문 주문에서 `Map<"zip:last4", group>` 빌드
2. `infos[].recipients[]` 순회하며 키 조회
3. hit 시 그 그룹에 `bookingReservationNo = info.reservationNo`, `trackingNumber = line.trackingNo` 업데이트, status=booked
4. 한 그룹이 두 번 매칭되면 경고 로그 (정상이면 발생 X — 키가 unique해야 함)

### 6. dispatch-worker 분기

기존 `checkAndDispatch()` 안에서 일반택배 스크래핑(`scrapeTrackingNumbers`) 직후
방문택배 처리를 추가:

```typescript
// 기존: booked 일반 그룹의 운송장 스크래핑
// ↓ 추가
if (isWithinScrapeWindow()) {
  const visitGroups = getBookingVisitPickupGroups();
  if (visitGroups.length > 0) {
    try {
      const knownNos = []; // booking 상태라 아직 reservation_no가 없으므로 빈 배열
      const visitInfos = await scrapeVisitPickup(knownNos);
      const { matched, unmatched } = applyVisitDispatchInfo(visitInfos);
      console.log(
        `[dispatch-worker] 방문택배 매칭 — ${matched}건 success, ${unmatched}건 보류`,
      );
      result.tracked += matched;
    } catch (err) {
      // 쿠키 만료 또는 파싱 실패 — 다음 폴링에서 재시도
      const msg = err instanceof Error ? err.message : "알 수 없는 오류";
      console.warn(`[dispatch-worker] ⚠️ 방문택배 스크래핑 실패 — ${msg}`);
      result.errors.push(msg);
    }
  }
}
```

매칭된 그룹은 이후 `pendingDispatch` 필터(`trackingNumber && !dispatchStatus`) 에
자연스럽게 들어와서 기존 네이버 발송처리 흐름을 탄다. 추가 분기 불필요.

### 7. book-visit 라우트 수정

`bookOrders(orderIds)` 호출 직후, 방문택배 그룹의 `selectedDeliveryType`을 일괄
`"visit"` 으로 업데이트:

```typescript
bookOrders(orderIds);
markAsVisitPickup(orderIds);  // ← 신규 헬퍼
```

또는 기존 `bookOrders` 시그니처에 deliveryType 옵션 추가. 기존 코드 영향 최소화
관점에서 별도 함수 권장.

### 8. 동기화 (로컬→서버)

`sync-to-server.ts` 의 `syncBookingResult` 에서 방문택배 케이스도 같이 동기화되도록
이미 `orderItems[].selectedDeliveryType` 을 전달 중. enum 확장만 하면 됨
(zod 스키마: `z.enum(["domestic", "nextDay", "visit"])`).

`booking-result/route.ts` 의 `orderItemSchema.selectedDeliveryType` enum 확장.

### 9. 테스트 (`src/lib/gs-delivery/__tests__/scrape-visit-pickup.test.ts`)

Vitest 단위 테스트:

- `parseVisitDetailPage` — 사용자가 준 HTML 샘플 fixture 기반
  - 1명 수령인 정상 추출
  - N명 수령인 정상 추출
  - 우편번호 누락 시 그 블록 skip
  - 전화 끝4 마스킹 변형 케이스
- 매칭 로직 (`applyVisitDispatchInfo` 핵심 매칭 함수)
  - (zip, last4) 정확 매칭
  - 중복 키 발생 시 경고
  - 매칭 안 된 그룹은 그대로

## 데이터 흐름 다이어그램

```
[로컬 booking 그룹]                     [GS 사이트]
status=booking                          예약list 방문 행
selectedDeliveryType=visit                    ↓
recipientZipCode=47180                  상세페이지 fetch
recipientPhone=01012345655                    ↓
                                        delMInfo 블록 파싱
                                          → [{zip:47180, last4:5655, tracking:69824...}]
        ↓                                       ↓
        └──── 매칭 (zip+last4 키) ─────────────┘
                  ↓
        bookingReservationNo + trackingNumber 저장
        status → booked
                  ↓
        기존 네이버 발송처리 흐름 합류
```

## 단계별 작업 순서

1. **schema enum 확장** + 마이그레이션 동작 확인 (로컬 DB로 테스트)
2. **types.ts + selectors.ts 상수**
3. **scrape-visit-pickup.ts 신설** (단위 테스트 동시 진행)
4. **orders.ts 헬퍼 함수** (`getBookingVisitPickupGroups`, `applyVisitDispatchInfo`, `markAsVisitPickup`)
5. **book-visit 라우트** (selectedDeliveryType 마킹)
6. **dispatch-worker 분기 추가**
7. **sync zod 스키마 확장**
8. **로컬 E2E**: 실제 방문택배 1건 → 결제 → 폴링 → 매칭 → booked → dispatched 확인
9. **서버 배포**

## 테스트 전략

- **단위 테스트** (Vitest): 파서 + 매칭 로직 (HTML fixture 기반)
- **수동 통합 테스트**: 로컬에서 실제 방문택배 1건으로 전체 흐름 검증
  - 폼 입력 → 결제 → 폴링 대기 → DB 변화 관찰 → 네이버 발송처리 확인
- **회귀 테스트**: 일반택배(domestic/nextDay) 흐름이 영향 받지 않는지 확인
  (enum 확장만으로 기존 로직 변경 없음 — 안전)

## 위험 / 모니터링

ADR-0001 Consequences 참조. 추가로:

- **상세페이지 fetch 방식**: 만약 onclick 핸들러가 AJAX POST를 호출하는 형태라면
  쿠키 + Referer + 적절한 form-encoded body 필요. 첫 구현 시 fetch 결과를 로그로
  남기고, 200 못 받으면 onclick JS를 재분석.
- **매칭 실패**: `unmatched > 0` 이 지속되면 GS 마스킹 정책 변경 가능성. 로그 누적
  필요.

## 도메인 문서

이 프로젝트는 `docs/domains/` 디렉토리가 없으므로 도메인 문서 갱신 N/A.
대신 ADR + 본 계획서가 영구 참조점.

## 작업 외 (Out of Scope)

- 방문택배 결제 자동화 (Cloudflare/PG/카드 입력은 사용자 본인)
- 마스킹 해제 자동화 (Cloudflare Turnstile)
- 방문택배 취소 처리 (별도 흐름 필요 시 차후 이슈)
