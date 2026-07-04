import { scrapeTrackingNumbers } from "@/lib/gs-delivery/scrape-tracking";
import { scrapeVisitPickup } from "@/lib/gs-delivery/scrape-visit-pickup";
import { maskId } from "@/lib/log-mask";
import { dispatchOrders, DELIVERY_COMPANY_CODES } from "@/lib/naver/dispatch";
import { fetchDeliveryStatuses } from "@/lib/naver/orders";
import {
  addBookingLog,
  applyVisitDispatchInfo,
  getBookedOrderGroups,
  getBookingVisitPickupGroups,
  getMatchedVisitReservationNos,
  getUncheckedDispatchedOrders,
  updateDeliveryStatus,
  updateDispatchStatus,
  updateTrackingNumbers,
} from "@/lib/orders";
import {
  getDispatchPollIntervalMs,
  getNextDayDeliveryCode,
  isDispatchAutoMode,
} from "@/lib/settings";

let pollTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

/**
 * 운송장 스크래핑 허용 시간대 (KST).
 *
 * 하한이 8시인 이유: 스크래핑은 "처리할 booked 주문이 있을 때만" 돈다
 * (checkAndDispatch의 `reservationNos.length > 0 && isWithinScrapeWindow()` 조건).
 * 따라서 하한을 낮춰도 평소(11시 이후 예약)엔 아침에 처리할 주문이 없어
 * 스크래핑하지 않는다 → 사실상 11시부터 동작. 반면 아침 일찍 예약한 날은
 * 그 시각부터 폴링이 돌아 (1) 운송장을 일찍 잡고 (2) 2분 간격 요청이
 * GS 세션을 keep-alive 해서 idle 만료를 막는다.
 * → 날짜별 동적 윈도우 로직 없이 "아침 예약 날만 당겨지는" 효과를 얻는다.
 */
const SCRAPE_START_HOUR = 8; // 오전 8시
const SCRAPE_END_HOUR = 18; // 오후 6시

/**
 * 방문택배 GS 상세페이지 재요청 throttle.
 *
 * PR #60 직후 dispatch-worker가 매 폴링마다 `scrapeVisitPickup([])` 호출 →
 * GS list 방문 행 N건 전체의 detail POST를 매번 다시 요청 → GS가 봇 트래픽으로
 * 인식해 세션을 빠르게 invalidate (2~3시간 안에 만료) 시키는 문제 발생.
 *
 * Fix: 한 번 detail fetch한 GS 예약번호는 TTL 동안 다시 fetch하지 않는다.
 *   - DB 기반 known: getMatchedVisitReservationNos() — 이미 매칭 완료된 거
 *   - 메모리 기반 recent: 매칭 실패했어도 같은 사이클에서 반복 fetch 방지
 *
 * 메모리 캐시는 PM2 재시작 시 비어 폴링 윈도우(11~18 KST) 안에선 자동으로
 * 자기복구 (다음 사이클부터 다시 채워짐).
 */
const recentlyAttemptedVisits = new Map<string, number>();
const VISIT_DETAIL_RETRY_INTERVAL_MS = 60 * 60 * 1000; // 60분

function getKnownVisitReservationNos(): string[] {
  const matched = getMatchedVisitReservationNos();
  const now = Date.now();
  const recent: string[] = [];
  for (const [no, ts] of recentlyAttemptedVisits.entries()) {
    if (now - ts > VISIT_DETAIL_RETRY_INTERVAL_MS) {
      recentlyAttemptedVisits.delete(no);
    } else {
      recent.push(no);
    }
  }
  return Array.from(new Set([...matched, ...recent]));
}

function markVisitReservationAttempted(reservationNo: string): void {
  recentlyAttemptedVisits.set(reservationNo, Date.now());
}

/** 테스트용 — 캐시 초기화 */
export function _resetVisitAttemptCacheForTest(): void {
  recentlyAttemptedVisits.clear();
}

/** 현재 시간이 스크래핑 허용 시간대인지 확인 */
function isWithinScrapeWindow(): boolean {
  const now = new Date();
  const kstHour = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }),
  ).getHours();
  return kstHour >= SCRAPE_START_HOUR && kstHour < SCRAPE_END_HOUR;
}

/** 폴링 시작 (앱 초기화 시 호출) */
export function startDispatchPolling(): void {
  if (pollTimer) return;

  const intervalMs = getDispatchPollIntervalMs();
  // 즉시 1회 실행 후 인터벌 시작
  void checkAndDispatch();
  pollTimer = setInterval(() => void checkAndDispatch(), intervalMs);
  console.log(`[dispatch-worker] 폴링 시작 (${intervalMs / 1000 / 60}분 간격)`);
}

/** 폴링 중지 */
export function stopDispatchPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log("[dispatch-worker] 폴링 중지");
  }
}

/** 현재 상태 */
export function getDispatchWorkerStatus(): {
  isPolling: boolean;
  isRunning: boolean;
} {
  return { isPolling: pollTimer !== null, isRunning };
}

export interface CheckAndDispatchResult {
  tracked: number;
  dispatched: number;
  errors: string[];
}

/**
 * 운송장번호가 있고 아직 발송 안 된 booked 그룹을 네이버로 발송처리한다.
 * 워커(자동 모드 폴링)와 수동 즉시 발송 엔드포인트가 공유하는 발송 로직.
 *
 * `getBookedOrderGroups()`가 status='booked'만 반환하므로, 발송 완료되어
 * dispatched로 바뀐 그룹은 다음 조회에서 빠져 이중발송을 막는다.
 *
 * @param orderIds 지정 시 해당 orderId 그룹만 발송 (미지정 시 pending 전체)
 * @returns 발송 성공/실패한 orderId 목록
 */
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
      group.deliveryType === "nextDay"
        ? getNextDayDeliveryCode()
        : DELIVERY_COMPANY_CODES.domestic;

    try {
      const dispatchResult = await dispatchOrders({
        productOrderIds: group.productOrderIds,
        deliveryCompanyCode,
        trackingNumber: group.trackingNumber!,
      });

      if (dispatchResult.success) {
        updateDispatchStatus(group.orderId, "dispatched");
        addBookingLog(
          group.firstDbId,
          "dispatch",
          `네이버 발송처리 완료: ${group.trackingNumber}`,
        );
        dispatched.push(group.orderId);
        console.log(
          `[dispatch-worker] ✅ 발송처리 완료 — 주문: ${maskId(group.orderId)}`,
        );
      } else {
        updateDispatchStatus(group.orderId, "dispatch_failed");
        const errMsg = dispatchResult.error ?? "알 수 없는 오류";
        addBookingLog(group.firstDbId, "error", `발송처리 실패: ${errMsg}`);
        failed.push({ orderId: group.orderId, error: errMsg });
        console.error(
          `[dispatch-worker] ❌ 발송처리 실패 — ${maskId(group.orderId)}: ${errMsg}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "알 수 없는 오류";
      failed.push({ orderId: group.orderId, error: msg });
      console.error(
        `[dispatch-worker] ❌ 예외 — ${maskId(group.orderId)}: ${msg}`,
      );
    }
  }

  return { dispatched, failed };
}

/**
 * 1회 실행: booked 주문의 운송장번호 확인 → (자동 모드이면) 발송처리
 */
export async function checkAndDispatch(): Promise<CheckAndDispatchResult> {
  if (isRunning) {
    return { tracked: 0, dispatched: 0, errors: ["이미 실행 중"] };
  }
  isRunning = true;

  const result: CheckAndDispatchResult = {
    tracked: 0,
    dispatched: 0,
    errors: [],
  };

  try {
    // 0. 방문택배 매칭 (ADR-0001) — booking + visit 그룹을 GS 예약list에서 찾아 booked 전환.
    //    booked로 전환된 그룹은 1단계의 getBookedOrderGroups 조회에 자연스럽게 포함되어
    //    같은 폴링 사이클에서 발송처리까지 완료된다.
    if (isWithinScrapeWindow()) {
      const visitGroups = getBookingVisitPickupGroups();
      if (visitGroups.length > 0) {
        try {
          // 이미 처리/시도한 예약은 detail fetch에서 제외 → GS 봇 감지 회피
          const knownNos = getKnownVisitReservationNos();
          const visitInfos = await scrapeVisitPickup(knownNos);
          // 새로 detail fetch한 예약(매칭 성공/실패 무관)을 캐시에 기록 →
          // 다음 폴링부터 60분 동안 재요청 안 함.
          for (const info of visitInfos) {
            markVisitReservationAttempted(info.reservationNo);
          }
          const { matched, unmatched, reservations } =
            applyVisitDispatchInfo(visitInfos);
          if (matched > 0 || unmatched > 0) {
            console.log(
              `[dispatch-worker] 방문택배 매칭 — 성공 ${matched}건, 보류 ${unmatched}건` +
                (reservations.length > 0
                  ? ` (예약: ${reservations.map(maskId).join(", ")})`
                  : ""),
            );
          }
          result.tracked += matched;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "알 수 없는 오류";
          console.warn(`[dispatch-worker] ⚠️ 방문택배 스크래핑 실패 — ${msg}`);
          result.errors.push(msg);
        }
      }
    }

    // 1. booked 상태 주문 그룹 조회 (방금 매칭된 방문택배 포함)
    const bookedGroups = getBookedOrderGroups();

    if (bookedGroups.length > 0) {
      // 2. 예약번호가 있는 주문에서 운송장번호 스크래핑
      const reservationNos = bookedGroups
        .map((g) => g.bookingReservationNo)
        .filter((n): n is string => !!n);

      // 3. 예약번호가 있는 주문만 운송장번호 스크래핑 (11시~18시만)
      if (reservationNos.length > 0 && isWithinScrapeWindow()) {
        try {
          const trackingResults = await scrapeTrackingNumbers(reservationNos);

          for (const tr of trackingResults) {
            if (!tr.trackingNo) continue;

            const group = bookedGroups.find(
              (g) => g.bookingReservationNo === tr.reservationNo,
            );
            if (!group) continue;

            // 이미 운송장번호가 있으면 스킵
            if (group.trackingNumber) continue;

            updateTrackingNumbers(group.orderId, tr.trackingNo);
            addBookingLog(
              group.firstDbId,
              "tracking",
              `운송장번호 감지: ${tr.trackingNo}`,
            );
            result.tracked++;
            console.log(
              `[dispatch-worker] 운송장 감지 — 주문: ${maskId(group.orderId)}, 운송장: ${maskId(tr.trackingNo)}`,
            );
          }
        } catch (err) {
          // 쿠키 만료 또는 스크래핑 실패 — 로그만 남기고 스킵 (다음 폴링에서 재시도)
          const msg = err instanceof Error ? err.message : "알 수 없는 오류";
          console.warn(`[dispatch-worker] ⚠️ 운송장 스크래핑 실패 — ${msg}`);
          result.errors.push(msg);
        }
      }

      // 4. 자동 모드일 때만 발송처리 (운송장 있고 아직 발송 안 된 그룹)
      if (isDispatchAutoMode()) {
        const { dispatched, failed } = await dispatchBookedGroups();
        result.dispatched += dispatched.length;
        for (const f of failed) {
          result.errors.push(`${f.orderId}: ${f.error}`);
        }
      }
    }

    // 6. 발송완료 주문 배송상태 확인 (배송상태 미확인 건만)
    try {
      const unchecked = getUncheckedDispatchedOrders();
      if (unchecked.length > 0) {
        const deliveryInfos = await fetchDeliveryStatuses(
          unchecked.map((o) => o.productOrderId),
        );
        for (const order of unchecked) {
          const info = deliveryInfos.get(order.productOrderId);
          if (info) {
            updateDeliveryStatus(
              order.productOrderId,
              info.status,
              info.pickupDate,
            );
            console.log(
              `[dispatch-worker] 📦 ${info.status === "delivering" ? "집화 확인" : "배송 완료"} — 주문: ${maskId(order.orderId)}`,
            );
          }
        }
      }
    } catch (err) {
      // 배송상태 확인 실패는 무시 (다음 폴링에서 재시도)
      console.error("[dispatch-worker] 배송상태 확인 실패:", err);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "알 수 없는 오류";
    result.errors.push(msg);
    console.error("[dispatch-worker] 폴링 실패:", msg);
  } finally {
    isRunning = false;
  }

  return result;
}
