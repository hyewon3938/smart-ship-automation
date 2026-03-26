import { closeBrowser, newPage } from "./browser";
import { ensureLoggedIn, LoginError } from "./auth";
import { bookDomestic, bookNextDay } from "./automation";
import { bookVisitPickup } from "./visit-pickup";

import {
  addBookingLog,
  recoverStuckBookings,
  updateOrderStatusBatch,
} from "@/lib/orders";
import { resyncBookedOrders, syncBookingResult } from "@/lib/sync-to-server";

import type { BookingTask, VisitPickupTask } from "./types";

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
 * 큐에서 1건씩 꺼내 순차 처리.
 * 실패해도 나머지 건을 계속 처리한다 (브라우저 크래시만 중단).
 */
async function processNext(): Promise<void> {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;

  const task = queue.shift()!;
  let browserCrashed = false;

  try {
    await processSingleOrder(task);
  } catch (error) {
    browserCrashed = true;
    const msg = error instanceof Error ? error.message : "알 수 없는 오류";
    // 그룹 내 모든 상품을 failed로 일괄 변경
    updateOrderStatusBatch(task.orderDbIds, "failed", msg);
    addBookingLog(task.orderDbIds[0], "error", `예상치 못한 실패: ${msg}`);
    console.error(`[worker] ❌ 예약 실패 — 주문: ${task.naverOrderId}, 에러: ${msg}`);

    await closeBrowser();
  } finally {
    isProcessing = false;

    if (browserCrashed) {
      drainQueue();
    } else if (queue.length === 0) {
      // 큐 처리 완료 — 동기화 누락된 booked 주문 재전송
      void resyncBookedOrders();
    } else {
      processNext();
    }
  }
}

const MAX_RETRIES = 2;
const RETRY_DELAYS = [2000, 4000]; // ms

/**
 * 단일 주문 그룹 예약 처리 (같은 orderId = 1건 택배).
 * 실패 시 최대 2회 재시도 (지수 백오프: 2s / 4s).
 */
async function processSingleOrder(task: BookingTask): Promise<void> {
  const logId = task.orderDbIds[0]; // 로그는 첫 번째 DB row에 기록

  addBookingLog(logId, "start", `예약 시작: ${task.recipientName} (${task.orderDbIds.length}개 상품)`);
  console.log(
    `[worker] 예약 시작 — 주문: ${task.naverOrderId}, 수령인: ${task.recipientName}, 상품 ${task.orderDbIds.length}개`
  );

  let lastResult: Awaited<ReturnType<typeof bookDomestic>> | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS[attempt - 1];
      addBookingLog(logId, "retry", `재시도 ${attempt}/${MAX_RETRIES}회 (${delay / 1000}초 후)`);
      console.log(`[worker] 재시도 ${attempt}/${MAX_RETRIES} — ${delay}ms 후`);
      await new Promise((r) => setTimeout(r, delay));
    }

    const page = await newPage();
    try {
      await ensureLoggedIn(page);
      if (attempt === 0) {
        addBookingLog(logId, "login", "로그인 확인 완료");
        console.log("[worker] 로그인 확인 완료 ✓");
      }

      console.log(
        `[worker] 폼 자동화 시작 — 유형: ${task.deliveryType === "nextDay" ? "내일배송" : "국내택배"}`
      );
      const result =
        task.deliveryType === "nextDay"
          ? await bookNextDay(page, task)
          : await bookDomestic(page, task);

      lastResult = result;

      if (result.success) {
        updateOrderStatusBatch(
          task.orderDbIds,
          "booked",
          JSON.stringify({ reservationNo: result.reservationNo }),
          result.reservationNo
        );
        addBookingLog(
          logId,
          "complete",
          `예약 완료${result.reservationNo ? `: ${result.reservationNo}` : ""}`
        );
        console.log(
          `[worker] ✅ 예약 완료 — 주문: ${task.naverOrderId}, 예약번호: ${result.reservationNo ?? "(없음)"}`
        );
        void syncBookingResult({
          orderId: task.naverOrderId,
          status: "booked",
          bookingResult: JSON.stringify({ reservationNo: result.reservationNo }),
          bookingReservationNo: result.reservationNo,
        });
        return;
      }

      console.warn(`[worker] ⚠️ 시도 ${attempt + 1} 실패: ${result.error}`);
    } catch (err) {
      // LoginError는 재시도해도 해결 불가 — 즉시 최종 실패 처리
      if (err instanceof LoginError) {
        const msg = err.message;
        console.error(`[worker] ❌ 로그인 실패 — 재시도 불가: ${msg}`);
        updateOrderStatusBatch(task.orderDbIds, "failed", msg);
        addBookingLog(logId, "error", `로그인 실패: ${msg}`);
        void syncBookingResult({
          orderId: task.naverOrderId,
          status: "failed",
          error: msg,
        });
        return;
      }
      throw err; // 다른 에러는 기존 로직으로 전파
    } finally {
      await page.close().catch(() => {});
    }
  }

  // 모든 재시도 소진 → 최종 실패 처리
  updateOrderStatusBatch(
    task.orderDbIds,
    "failed",
    lastResult?.error ?? "알 수 없는 오류"
  );
  addBookingLog(
    logId,
    "error",
    `예약 실패 (${MAX_RETRIES + 1}회 시도): ${lastResult?.error}`,
    lastResult?.screenshotPath
  );
  console.error(`[worker] ❌ 최종 실패 — 주문: ${task.naverOrderId}`);
  if (lastResult?.screenshotPath) {
    console.error(`[worker] 📸 스크린샷: ${lastResult.screenshotPath}`);
  }
  void syncBookingResult({
    orderId: task.naverOrderId,
    status: "failed",
    error: lastResult?.error ?? "알 수 없는 오류",
  });
}

/**
 * 큐에 남은 작업을 모두 제거하고 해당 주문들을 pending으로 복구.
 */
function drainQueue(): void {
  if (queue.length === 0) return;

  console.warn(
    `[worker] ⚠️ 실패로 인해 나머지 ${queue.length}건 처리 중단 — pending으로 복구`
  );

  for (const remaining of queue) {
    updateOrderStatusBatch(remaining.orderDbIds, "pending");
    addBookingLog(
      remaining.orderDbIds[0],
      "info",
      "이전 주문 실패로 처리 중단됨 — pending으로 복구"
    );
  }

  queue.length = 0;
}

/** 현재 큐 상태 조회 */
export function getWorkerStatus(): {
  isProcessing: boolean;
  queueLength: number;
} {
  return { isProcessing, queueLength: queue.length };
}

/**
 * 방문택배 다량 접수 처리.
 * 일반 예약과 달리:
 * - 재시도 없음 (폼 채우기만 함)
 * - 페이지를 닫지 않음 (사용자가 직접 확인 + 예약)
 * - 실패 시 전체 주문을 pending으로 복구
 */
export async function enqueueVisitPickup(task: VisitPickupTask): Promise<void> {
  initOnce();

  const logId = task.allOrderDbIds[0];
  addBookingLog(
    logId,
    "start",
    `방문택배 다량 접수 시작: ${task.recipients.length}명 수령인`
  );
  console.log(
    `[worker] 방문택배 시작 — ${task.recipients.length}명 수령인, ${task.allOrderDbIds.length}개 상품`
  );

  const page = await newPage();
  try {
    await ensureLoggedIn(page);
    addBookingLog(logId, "login", "로그인 확인 완료");
    console.log("[worker] 로그인 확인 완료 ✓");

    console.log("[worker] 방문택배 폼 자동화 시작");
    const result = await bookVisitPickup(page, task);

    if (result.success) {
      addBookingLog(
        logId,
        "complete",
        `방문택배 폼 입력 완료: ${task.recipients.length}명 수령인 — 브라우저에서 예약하기를 클릭해주세요`
      );
      console.log(
        `[worker] ✅ 방문택배 폼 입력 완료 — 브라우저에서 확인 후 예약하기를 클릭해주세요`
      );
      // 페이지를 닫지 않음 — 사용자가 직접 확인하고 예약
    } else {
      updateOrderStatusBatch(task.allOrderDbIds, "failed", result.error);
      addBookingLog(logId, "error", `방문택배 실패: ${result.error}`, result.screenshotPath);
      console.error(`[worker] ❌ 방문택배 실패: ${result.error}`);
      await page.close().catch(() => {});
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 오류";
    updateOrderStatusBatch(task.allOrderDbIds, "failed", msg);
    addBookingLog(logId, "error", `방문택배 실패: ${msg}`);
    console.error(`[worker] ❌ 방문택배 실패: ${msg}`);
    await page.close().catch(() => {});
    await closeBrowser();
  }
}
