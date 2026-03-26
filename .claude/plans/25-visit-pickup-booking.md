# feat(gs-delivery): 방문택배 다량 접수 예약 기능 추가

## 이슈
- 번호: #25
- 브랜치: `feat/25-visit-pickup-booking`

## 개요
방문택배 다량 접수 예약 기능 추가. 3건 이상의 주문을 하나의 방문택배 예약으로 묶어 GS택배 사이트에 Playwright로 폼을 자동 입력한다. 결제가 필요하므로 최종 "예약하기" 버튼은 사용자가 직접 클릭.

## 변경 파일 목록
| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `src/lib/gs-delivery/types.ts` | 수정 | VisitPickupTask 타입 추가 |
| `src/lib/gs-delivery/selectors.ts` | 수정 | 방문택배 URL + 셀렉터 추가 |
| `src/lib/gs-delivery/visit-pickup.ts` | 신규 | 방문택배 Playwright 자동화 |
| `src/lib/gs-delivery/worker.ts` | 수정 | 방문택배 큐 처리 추가 |
| `src/app/api/orders/book-visit/route.ts` | 신규 | 방문택배 예약 API |
| `src/hooks/useOrders.ts` | 수정 | useBookVisitPickup 훅 추가 |
| `src/components/VisitPickupConfirmDialog.tsx` | 신규 | 방문택배 확인 다이얼로그 |
| `src/components/Dashboard.tsx` | 수정 | 방문택배 버튼 + 다이얼로그 연결 |

## 구현 상세

### 1. 타입 추가 (`src/lib/gs-delivery/types.ts`)

**After:**
```typescript
/** 방문택배 수령인 정보 */
export interface VisitPickupRecipient {
  orderDbIds: number[];
  naverOrderId: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  recipientAddressDetail: string | null;
  recipientZipCode: string;
}

/** 방문택배 다량 접수 작업 */
export interface VisitPickupTask {
  /** 전체 DB row IDs (모든 수령인의 모든 상품) */
  allOrderDbIds: number[];
  /** 수령인 목록 (각각 1건의 택배) */
  recipients: VisitPickupRecipient[];
  /** 물품 가액 (1건 기준, 원 단위) — 첫 번째 그룹의 합계 사용 */
  unitPrice: number;
}
```

### 2. 셀렉터 추가 (`src/lib/gs-delivery/selectors.ts`)

방문택배 URL과 폼 셀렉터 추가:

```typescript
// GS_URLS에 추가
VISIT_PICKUP: "https://www.cvsnet.co.kr/reservation-inquiry/visit/visitIndex.do",

// 방문택배 전용 셀렉터
export const VISIT_PICKUP_SELECTORS = {
  /** 다량 접수 버튼 */
  BULK_SUBMIT: "다량 접수",
  /** 접수 수량/운임 확인 체크박스 */
  FREIGHT_CONFIRM_CHECKBOX: "접수 수량 및 운임을 확인",
  /** 받는 분 추가 버튼 (첫 번째 → 두 번째) */
  RECEIVER_ADD_BTN: "#btn_receiver_add",
  /** 받는 분 추가 버튼 (세 번째 이후) */
  RECEIVER_PLUS_BTN: ".btn_receiver_plus",
  /** 방문 희망일 첫 번째 라디오/옵션 */
  VISIT_DATE_FIRST: "input[name='visit_date']:first-of-type",
  /** 택배 전달방식 */
  DELIVERY_METHOD: "부재중으로 현관문 앞에 두겠습니다",
  /** 박스 크기 2kg 이하 + 버튼 */
  BOX_SIZE_PLUS: "2kg",
} as const;
```

### 3. 방문택배 자동화 (`src/lib/gs-delivery/visit-pickup.ts`)

핵심 함수: `bookVisitPickup(page, task)`

**자동화 흐름:**

1. **페이지 이동** → 방문택배 URL
2. **주의사항 팝업** → "인지하였습니다" 클릭
3. **접수 수량/운임 체크** → 체크박스 클릭
4. **"다량 접수" 클릭**
5. **물품 정보 입력:**
   - 품목: 잡화/서적 (08)
   - 동의 체크
   - 물품가액: 1건 기준 만원 올림
   - 예약명: "리뷰어 발송"
6. **방문 희망일:** 첫 번째 선택 (내일)
7. **택배 전달방식:** "부재중으로 현관문 앞에 두겠습니다." 선택
8. **보내는 분:** 주소록에서 "리커밋" 선택
9. **첫 번째 받는 분:** 배송 정보 입력
10. **박스 크기:** "2kg 이하" +버튼 클릭 → 1개
11. **두 번째 받는 분:** `#btn_receiver_add` 클릭 → alert 확인 → 정보 입력
12. **세 번째+ 받는 분:** `.btn_receiver_plus` 클릭 → 정보 입력
13. **완료** — 예약하기 버튼 클릭 안 함, 페이지 열어둠

### 4. 워커 수정 (`src/lib/gs-delivery/worker.ts`)

```typescript
export function enqueueVisitPickup(task: VisitPickupTask): void {
  // 방문택배는 별도 처리 — 페이지를 닫지 않음
  processVisitPickup(task);
}
```

방문택배 처리 특징:
- 재시도 없음 (폼 채우기만 하므로)
- 페이지를 닫지 않음 (사용자가 확인 후 예약)
- 성공 시 상태를 "booking"으로 유지

### 5. API 라우트 (`src/app/api/orders/book-visit/route.ts`)

```typescript
// POST /api/orders/book-visit
// Body: { orderIds: number[] }
//
// 1. 최소 3건 검증
// 2. orderId 기준 그룹화 → 수령인 목록 생성
// 3. 상태 → "booking"
// 4. VisitPickupTask 생성 → enqueueVisitPickup
```

### 6. 훅 추가 (`src/hooks/useOrders.ts`)

```typescript
export function useBookVisitPickup() {
  // POST /api/orders/book-visit
  // 성공 시 orders 쿼리 무효화
}
```

### 7. 확인 다이얼로그 (`src/components/VisitPickupConfirmDialog.tsx`)

- 제목: "방문택배 예약"
- 안내문: "N건의 주문을 하나의 방문택배 예약으로 묶습니다."
- 수령인 목록 미리보기
- 주의: "폼 입력 후 브라우저에서 직접 예약하기를 클릭해주세요."
- 최소 3건 미만 시 경고

### 8. 대시보드 수정 (`src/components/Dashboard.tsx`)

액션 바에 "방문택배" 버튼 추가:
- 기존 "선택 건 예약" 버튼 옆에 배치
- 3건 이상 선택 시에만 활성화
- 클릭 시 VisitPickupConfirmDialog 열기

## 커밋 계획
1. `feat(gs-delivery): 방문택배 타입 + 셀렉터 추가` - types.ts, selectors.ts
2. `feat(gs-delivery): 방문택배 Playwright 자동화 구현` - visit-pickup.ts, worker.ts
3. `feat(api): 방문택배 예약 API + UI 연결` - route.ts, useOrders.ts, Dashboard.tsx, VisitPickupConfirmDialog.tsx

## 테스트 계획
- [ ] 타입 빌드 오류 없음 확인 (tsc --noEmit)
- [ ] 기존 국내택배 예약 플로우 영향 없음 확인
- [ ] 빌드 성공 확인 (npm run build)

## 체크리스트
- [ ] 프로젝트 컨벤션 규칙 준수
- [ ] 민감 정보 하드코딩 없음
- [ ] 타입 안전성 확인
- [ ] 에러 핸들링 포함
- [ ] 기존 코드와의 일관성 유지
