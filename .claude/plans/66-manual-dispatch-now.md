# feat(dispatch): 윈도우 밖·세션 만료 상황용 '지금 발송처리' 버튼

## 이슈
- 번호: #66
- 브랜치: feat/66-manual-dispatch-now
- 마스터: 없음 (독립 기능)
- design-notebook: 없음 (마스터 단위 아님 → 생략)

## 개요
스크래핑 윈도우(8~18시) 밖이나 GS 세션 만료 상황에서, 로컬 대시보드 버튼 하나로
세션 확인 → (필요시) 로그인 → 운송장 스크래핑(윈도우 무시) → 서버 즉시 발송처리까지
자동 수행. 2026-07-04 저녁 7건을 수동으로 처리한 흐름을 재사용 가능한 기능으로 만든다.

## 설계 결정 (인터뷰 확정)
- **버튼은 로컬(Mac) 전용** — GS 로그인·스크래핑은 캡챠·쿠키 때문에 로컬에서만 가능
- **발송은 서버가 단독 수행** — 로컬은 운송장만 넘기고 서버가 즉시 발송처리
  (이중발송 방지 + 자동모드 무관 + 결과 즉시 확인)
- 근거: ADR-0003

## 변경 파일 목록
| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `src/lib/gs-delivery/session.ts` | 신규 | `probeGsSession()` — 예약조회 fetch로 세션 live 확인(200/302) |
| `src/lib/gs-delivery/scrape-tracking.ts` | 수정 | `loadCookieHeader()` export (session.ts 재사용) |
| `src/lib/dispatch-worker.ts` | 수정 | 발송 로직을 `dispatchBookedGroups(orderIds?)`로 추출 |
| `src/app/api/internal/dispatch-now/route.ts` | 신규 | (서버) 운송장 수신 → 즉시 발송처리, 자동모드 무관 |
| `src/app/api/dispatch/manual-now/route.ts` | 신규 | (로컬) 오케스트레이터: 세션확인→스크래핑→서버발송 |
| `src/lib/sync-to-server.ts` | 수정 | `syncDispatchNow(items)` 추가 |
| `src/hooks/useDispatch.ts` | 수정 | `useManualDispatchNow()`, `useGsLogin()` 추가 |
| `src/components/DispatchPanel.tsx` | 수정 | "운송장 동기화" → "지금 발송처리" (로그인 재시도 흐름) |
| `src/components/Dashboard.tsx` | 수정 | `handleGsLogin`을 `useGsLogin` 훅으로 정리(선택) |
| `docs/adr/0003-manual-out-of-window-dispatch.md` | 신규 | ADR |

## 구현 상세

### 1. GS 세션 live 프로브 (`session.ts`)

현재 `checkCookieValidity()`는 쿠키 **파일 나이(24h)**만 본다 → 파일은 신선한데
세션이 죽은 경우(2026-07-04 실제 발생: 20:09 로그인 → 22:10 이미 302)를 "유효"로 오판.
실제 요청을 날려 확인하는 프로브를 추가한다.

**After:**
```typescript
// src/lib/gs-delivery/session.ts
import { GS_URLS } from "./selectors";
import { loadCookieHeader } from "./scrape-tracking";

/** GS 세션이 실제로 살아있는지 확인 (예약조회 200 = live, 302 = 만료). */
export async function probeGsSession(): Promise<boolean> {
  const cookieHeader = loadCookieHeader();
  if (!cookieHeader) return false;
  try {
    const res = await fetch(GS_URLS.RESERVATION_LIST, {
      headers: {
        Cookie: cookieHeader,
        "User-Agent": GS_UA,               // scrape-tracking과 동일 UA 상수 공유
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9",
        Referer: "https://www.cvsnet.co.kr/",
      },
      redirect: "manual",
    });
    return res.status === 200;
  } catch {
    return false;
  }
}
```

**설명:** `scrape-tracking.ts`의 `loadCookieHeader`를 export하여 재사용. UA 문자열도
공용 상수로 뽑아 두 곳(scrape-tracking, session)이 공유. 프로브는 버튼 누를 때만
(on-demand) 호출 → 봇 감지 위험 최소.

### 2. 발송 로직 추출 (`dispatch-worker.ts`)

`checkAndDispatch`의 4~5단계(운송장 있는 booked 그룹 발송처리)를 재사용 가능한
함수로 추출. 워커(자동모드)와 새 서버 엔드포인트(수동, 자동모드 무관)가 공유.

**Before:** (checkAndDispatch 내부, 자동모드 블록)
```typescript
if (isDispatchAutoMode()) {
  const freshGroups = getBookedOrderGroups();
  const pendingDispatch = freshGroups.filter(
    (g) => g.trackingNumber && (!g.dispatchStatus || g.dispatchStatus === "pending_dispatch"),
  );
  for (const group of pendingDispatch) { /* dispatchOrders → updateDispatchStatus */ }
}
```

**After:**
```typescript
// 추출된 재사용 함수 (dispatch-worker.ts)
export async function dispatchBookedGroups(orderIds?: string[]): Promise<{
  dispatched: string[];
  failed: { orderId: string; error: string }[];
}> {
  const groups = getBookedOrderGroups().filter(
    (g) =>
      g.trackingNumber &&
      (!g.dispatchStatus || g.dispatchStatus === "pending_dispatch") &&
      (!orderIds || orderIds.includes(g.orderId)),
  );
  const dispatched: string[] = [];
  const failed: { orderId: string; error: string }[] = [];
  for (const group of groups) {
    const deliveryCompanyCode =
      group.deliveryType === "nextDay" ? getNextDayDeliveryCode() : DELIVERY_COMPANY_CODES.domestic;
    try {
      const r = await dispatchOrders({
        productOrderIds: group.productOrderIds,
        deliveryCompanyCode,
        trackingNumber: group.trackingNumber!,
      });
      if (r.success) {
        updateDispatchStatus(group.orderId, "dispatched");
        addBookingLog(group.firstDbId, "dispatch", `네이버 발송처리 완료: ${group.trackingNumber}`);
        dispatched.push(group.orderId);
      } else {
        updateDispatchStatus(group.orderId, "dispatch_failed");
        addBookingLog(group.firstDbId, "error", `발송처리 실패: ${r.error ?? "알 수 없는 오류"}`);
        failed.push({ orderId: group.orderId, error: r.error ?? "알 수 없는 오류" });
      }
    } catch (err) {
      failed.push({ orderId: group.orderId, error: err instanceof Error ? err.message : "예외" });
    }
  }
  return { dispatched, failed };
}

// checkAndDispatch 내부는 이 함수를 호출하도록 축소
if (isDispatchAutoMode()) {
  const { dispatched } = await dispatchBookedGroups();
  result.dispatched += dispatched.length;
}
```

**설명:** `getBookedOrderGroups()`가 이미 `orderId` 기준 그룹이고 `status='booked'`만
반환 → 발송 후 `dispatched`로 바뀌면 재조회에서 빠져 이중발송 방지. `orderIds` 인자로
특정 주문만 발송 가능.

### 3. 서버 즉시 발송 엔드포인트 (`api/internal/dispatch-now`)

**After:**
```typescript
// src/app/api/internal/dispatch-now/route.ts  (서버에서 동작)
export async function POST(request: NextRequest) {
  const unauthorized = verifyInternalApiKey(request);
  if (unauthorized) return unauthorized;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null)); // {items:[{orderId,trackingNumber}]}
  if (!parsed.success) return NextResponse.json({ error: "요청 형식 오류" }, { status: 400 });

  const { items } = parsed.data;
  for (const it of items) {
    updateTrackingNumbers(it.orderId, it.trackingNumber);   // tracking + pending_dispatch
    addBookingLogByOrderId(it.orderId, "tracking", `운송장 수동 동기화: ${it.trackingNumber}`);
  }
  const { dispatched, failed } = await dispatchBookedGroups(items.map((i) => i.orderId));
  return NextResponse.json({ dispatched, failed, message: `발송 ${dispatched.length}건 완료` });
}
```

**설명:** 자동모드 체크 없이 명시적으로 발송. `/api/internal/tracking`(운송장만 넣고
워커에 맡김)과 구분 — 이건 "넣고 즉시 발송".

### 4. 로컬 오케스트레이터 (`api/dispatch/manual-now`)

**After:**
```typescript
// src/app/api/dispatch/manual-now/route.ts  (로컬에서만 동작)
export async function POST() {
  if (process.env.DEPLOY_MODE === "server") {
    return NextResponse.json({ error: "로컬 전용" }, { status: 400 });
  }
  // 1) 세션 실제 확인
  if (!(await probeGsSession())) {
    return NextResponse.json({ ok: false, needLogin: true, message: "GS 세션 만료 — 로그인 필요" });
  }
  // 2) booked + 예약번호 있고 운송장 없는 그룹 스크래핑 (윈도우 무시)
  const groups = getBookedOrderGroups().filter((g) => g.bookingReservationNo && !g.trackingNumber);
  if (groups.length === 0) return NextResponse.json({ ok: true, scraped: 0, dispatched: 0, message: "발송 대기 주문 없음" });

  const resvToOrder = new Map(groups.map((g) => [g.bookingReservationNo!, g.orderId]));
  const scraped = await scrapeTrackingNumbers([...resvToOrder.keys()]);
  const items = scraped
    .filter((s) => s.trackingNo)
    .map((s) => ({ orderId: resvToOrder.get(s.reservationNo)!, trackingNumber: s.trackingNo! }));

  if (items.length === 0) return NextResponse.json({ ok: true, scraped: 0, dispatched: 0, message: "운송장 미배정 (아직 GS에 안 뜸)" });

  // 3) 로컬 DB 운송장 반영(표시용) + 서버로 넘겨 즉시 발송
  for (const it of items) updateTrackingNumbers(it.orderId, it.trackingNumber);
  const serverRes = await syncDispatchNow(items); // sync-to-server.ts
  // 4) 서버가 발송한 건 로컬도 dispatched로 정리
  for (const orderId of serverRes?.dispatched ?? []) markOrderGroupAsDispatched(orderId);

  return NextResponse.json({
    ok: true,
    scraped: items.length,
    dispatched: serverRes?.dispatched?.length ?? 0,
    failed: serverRes?.failed ?? [],
    pending: groups.length - items.length,
  });
}
```

**설명:** 2026-07-04 밤 수동 흐름을 그대로 코드화. `scrapeTrackingNumbers`는 자체적으로
윈도우 게이트가 없으므로 직접 호출 = 윈도우 우회. 서버 발송 실패/미배정도 요약에 포함.

### 5. sync-to-server 추가

```typescript
// src/lib/sync-to-server.ts
export async function syncDispatchNow(
  items: Array<{ orderId: string; trackingNumber: string }>,
): Promise<{ dispatched: string[]; failed: { orderId: string; error: string }[] } | null> {
  if (items.length === 0) return { dispatched: [], failed: [] };
  const res = await postToServer("/api/internal/dispatch-now", { items });
  return res.ok ? (res.body as any) : null;
}
```

### 6. 프론트엔드 (`useDispatch.ts` + `DispatchPanel.tsx`)

- `useGsLogin()`: `POST /api/gs-login` 뮤테이션 (Dashboard.handleGsLogin도 이걸로 정리)
- `useManualDispatchNow()`: `POST /api/dispatch/manual-now` 뮤테이션
- DispatchPanel의 "운송장 동기화" 버튼 → **"지금 발송처리"**:
```typescript
async function handleManualNow() {
  let res = await manualNow.mutateAsync();
  if (res.needLogin) {
    toast.info("GS 세션 만료 — 브라우저에서 로그인(캡챠)을 진행합니다");
    const login = await gsLogin.mutateAsync();
    if (!login.success) return toast.error(login.message);
    res = await manualNow.mutateAsync(); // 재시도
  }
  if (res.dispatched > 0) toast.success(`발송처리 ${res.dispatched}건 완료`);
  else if (res.scraped === 0) toast.info(res.message);
  if (res.failed?.length) toast.error(`실패 ${res.failed.length}건`);
}
```
- 버튼은 기존과 동일하게 `!isServerMode`에서만 노출. `pending`(미배정) 건수도 토스트로 안내.

## ADR 작성

**대상 여부**: yes — 5조건 중 4개 충족 (대안 다수 존재 / 장기 영향 / 온보딩 설명 필요 / 비자명).

**번호**: 0003

**초안**: `docs/adr/0003-manual-out-of-window-dispatch.md`
- Context: 윈도우 게이트 + 저녁 세션 idle 만료 + mtime 기반 유효성 오판 → 수동 복구가 다단계.
- Decision: 로컬 전용 버튼이 세션프로브 → 로그인 → 윈도우우회 스크래핑 → 운송장을 서버로 넘기고 **서버가 단독 즉시 발송**.
- Alternatives:
  - (A) 로컬이 네이버 직접 발송 → 워커와 이중발송 위험 + 발송 책임 로컬 이전
  - (B) 서버(폰) 대시보드 버튼 → 캡챠 로그인 트리거 불가, 저녁엔 세션 죽어 반쪽 동작
  - (C) 서버 2분 자동폴링에 위임 → 지연 + 자동모드 의존 + 즉시 피드백 없음
  - (D) mtime 기반 세션 체크 유지 → 파일 신선/세션 사망 오판 (2026-07-04 실제)
- Consequences:
  - (+) 저녁/세션만료 케이스 원버튼 복구, 서버 단독 발송, 자동모드 무관, 정확한 세션 확인
  - (−) 로컬 전용(폰 불가), 프로브 요청 1회 추가, 수동 dispatch-now와 워커 폴링 간 좁은 레이스
  - 모니터링: dispatch-now↔워커 레이스(발송 전 status 재확인 + 네이버 멱등성으로 완화)

## 커밋 계획
1. `refactor(dispatch): 발송 로직 dispatchBookedGroups로 추출` — dispatch-worker.ts
2. `feat(gs-delivery): GS 세션 live 프로브 추가` — session.ts, scrape-tracking.ts
3. `feat(dispatch): 서버 즉시 발송 내부 엔드포인트` — api/internal/dispatch-now, sync-to-server.ts
4. `feat(dispatch): 로컬 '지금 발송처리' 오케스트레이터` — api/dispatch/manual-now
5. `feat(ui): 대시보드 '지금 발송처리' 버튼 + 로그인 재시도` — useDispatch.ts, DispatchPanel.tsx, Dashboard.tsx
6. `docs(adr): ADR-0003 윈도우 밖 수동 발송` — docs/adr/0003-*.md

## 테스트 계획
- [ ] `dispatchBookedGroups` — orderIds 필터/이중발송 방지 로직 단위 테스트 (mock DB)
- [ ] 세션 살아있음 + 윈도우 밖 → 버튼 누르면 스크래핑+발송 (수동 검증)
- [ ] 세션 만료 → 버튼 → 로그인 프롬프트 → 로그인 후 재시도 발송 (수동 검증)
- [ ] 운송장 미배정 상태 → "미배정" 안내, 발송 0건
- [ ] 서버 모드에서 manual-now 호출 시 400
- [ ] 발송 후 로컬·서버 DB 모두 dispatched 일치

## 체크리스트
- [ ] 프로젝트 컨벤션 준수 (레이어: 라우트→lib→DB, any 금지, zod 파싱)
- [ ] 민감 정보 하드코딩 없음 (INTERNAL_API_KEY는 env)
- [ ] 타입 안전성 (syncDispatchNow 반환 타입 명시 — any 제거)
- [ ] 에러 핸들링 (세션실패/스크래핑실패/서버발송실패 각각 안내)
- [ ] ADR-0003 작성
- [ ] 이중발송 레이스 가드 (발송 직전 status 재확인)
