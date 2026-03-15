import { closeBrowser, newPage } from "./browser";
import { ensureLoggedIn } from "./auth";
import { bookDomestic, bookNextDay } from "./automation";

import {
  addBookingLog,
  recoverStuckBookings,
  updateOrderStatus,
} from "@/lib/orders";

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
      updateOrderStatus(
        task.orderId,
        "failed",
        result.error ?? "알 수 없는 오류"
      );
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
