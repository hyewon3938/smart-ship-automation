import { scrapeTrackingNumbers } from "@/lib/gs-delivery/scrape-tracking";
import { dispatchOrders, DELIVERY_COMPANY_CODES } from "@/lib/naver/dispatch";
import { fetchDeliveryStatuses } from "@/lib/naver/orders";
import {
  addBookingLog,
  getBookedOrderGroups,
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
import { syncTrackingResult, syncDispatchResult } from "@/lib/sync-to-server";

let pollTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

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
 * 1회 실행: booked 주문의 운송장번호 확인 → (자동 모드이면) 발송처리
 */
export async function checkAndDispatch(): Promise<CheckAndDispatchResult> {
  if (isRunning) {
    return { tracked: 0, dispatched: 0, errors: ["이미 실행 중"] };
  }
  isRunning = true;

  const result: CheckAndDispatchResult = { tracked: 0, dispatched: 0, errors: [] };

  try {
    // 1. booked 상태 주문 그룹 조회
    const bookedGroups = getBookedOrderGroups();

    if (bookedGroups.length > 0) {
      // 2. 예약번호가 있는 주문에서 운송장번호 스크래핑
      const reservationNos = bookedGroups
        .map((g) => g.bookingReservationNo)
        .filter((n): n is string => !!n);

      // 3. 예약번호가 있는 주문만 운송장번호 스크래핑
      if (reservationNos.length > 0) {
        const trackingResults = await scrapeTrackingNumbers(reservationNos);

        for (const tr of trackingResults) {
          if (!tr.trackingNo) continue;

          const group = bookedGroups.find(
            (g) => g.bookingReservationNo === tr.reservationNo
          );
          if (!group) continue;

          // 이미 운송장번호가 있으면 스킵
          if (group.trackingNumber) continue;

          updateTrackingNumbers(group.orderId, tr.trackingNo);
          addBookingLog(
            group.firstDbId,
            "tracking",
            `운송장번호 감지: ${tr.trackingNo}`
          );
          void syncTrackingResult({
            orderId: group.orderId,
            trackingNumber: tr.trackingNo,
          });
          result.tracked++;
          console.log(
            `[dispatch-worker] 운송장 감지 — 주문: ${group.orderId}, 운송장: ${tr.trackingNo}`
          );
        }
      }

      // 4. 자동 모드일 때만 발송처리
      if (isDispatchAutoMode()) {
        // 5. 운송장번호 있고 아직 발송처리 안 된 그룹 처리
        const freshGroups = getBookedOrderGroups();
        const pendingDispatch = freshGroups.filter(
          (g) =>
            g.trackingNumber &&
            (!g.dispatchStatus || g.dispatchStatus === "pending_dispatch")
        );

        for (const group of pendingDispatch) {
          try {
            const deliveryCompanyCode =
              group.deliveryType === "nextDay"
                ? getNextDayDeliveryCode()
                : DELIVERY_COMPANY_CODES.domestic;

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
                `네이버 발송처리 완료: ${group.trackingNumber}`
              );
              void syncDispatchResult({
                orderId: group.orderId,
                status: "dispatched",
              });
              result.dispatched++;
              console.log(
                `[dispatch-worker] ✅ 발송처리 완료 — 주문: ${group.orderId}`
              );
            } else {
              updateDispatchStatus(group.orderId, "dispatch_failed");
              const errMsg = dispatchResult.error ?? "알 수 없는 오류";
              addBookingLog(
                group.firstDbId,
                "error",
                `발송처리 실패: ${errMsg}`
              );
              void syncDispatchResult({
                orderId: group.orderId,
                status: "dispatch_failed",
                error: errMsg,
              });
              result.errors.push(`${group.orderId}: ${errMsg}`);
              console.error(
                `[dispatch-worker] ❌ 발송처리 실패 — ${group.orderId}: ${errMsg}`
              );
            }
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : "알 수 없는 오류";
            result.errors.push(`${group.orderId}: ${msg}`);
            console.error(
              `[dispatch-worker] ❌ 예외 — ${group.orderId}: ${msg}`
            );
          }
        }
      }
    }

    // 6. 발송완료 주문 배송상태 확인 (배송상태 미확인 건만)
    try {
      const unchecked = getUncheckedDispatchedOrders();
      if (unchecked.length > 0) {
        const deliveryInfos = await fetchDeliveryStatuses(
          unchecked.map((o) => o.productOrderId)
        );
        for (const order of unchecked) {
          const info = deliveryInfos.get(order.productOrderId);
          if (info) {
            updateDeliveryStatus(
              order.productOrderId,
              info.status,
              info.pickupDate
            );
            console.log(
              `[dispatch-worker] 📦 ${info.status === "delivering" ? "집화 확인" : "배송 완료"} — 주문: ${order.orderId}`
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
