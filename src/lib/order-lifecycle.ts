/**
 * 주문 상태 전이 정책 — 순수 함수 모음 (DB 의존 없음).
 *
 * `lib/orders.ts`는 better-sqlite3를 즉시 로드하므로 정책 로직을 여기로 분리해
 * 테스트에서 실제 DB를 건드리지 않고 검증할 수 있게 한다.
 */

import type { DispatchStatus, OrderStatus } from "@/types";

// ─── 삭제 정책 ───

/** 삭제 가능한 상태 (예약 진행 중·발송완료는 제외) */
export const DELETABLE_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "booked",
  "failed",
  "skipped",
]);

/**
 * 주문 그룹 삭제 가능 여부 판정.
 * 삭제 불가면 사용자에게 보여줄 사유를, 가능하면 null을 반환한다.
 *
 * - `booking`: 로컬 Playwright 워커가 해당 row를 잡고 있음 → 예약 취소 후 삭제
 * - `dispatched`: 이미 네이버에 발송처리 완료 → 삭제하면 기록만 사라지고
 *   네이버에서 재수집도 되지 않아 복구 불가
 */
export function findDeleteBlocker(statuses: string[]): string | null {
  if (statuses.length === 0) return "주문을 찾을 수 없습니다";
  if (statuses.includes("booking")) {
    return "예약이 진행 중인 주문은 삭제할 수 없습니다. 예약을 취소한 뒤 다시 시도해주세요";
  }
  if (statuses.includes("dispatched")) {
    return "발송완료된 주문은 삭제할 수 없습니다";
  }
  const invalid = statuses.find((s) => !DELETABLE_STATUSES.has(s));
  if (invalid) return `삭제할 수 없는 상태입니다: ${invalid}`;
  return null;
}

/**
 * 삭제 전 서버 상태를 먼저 확인해야 하는지 여부.
 *
 * 로컬이 booked/failed 로 보고 있어도 서버가 이미 발송처리했을 수 있다
 * (역동기화 공백 — ADR-0005). 그 상태로 삭제하면 사용자는 "취소했다"고
 * 믿지만 실제로는 이미 출고된 주문이므로, 삭제 직전에 서버 상태를 한 번 당겨온다.
 * `pending`은 서버로 전송된 적이 없어 확인이 불필요하다.
 */
export function needsServerCheckBeforeDelete(statuses: string[]): boolean {
  return statuses.some(
    (s) => s === "booked" || s === "failed" || s === "booking",
  );
}

// ─── 서버 → 로컬 상태 역동기화 정책 ───

/** 주문 그룹 단위로 압축한 발송 진행 상태 */
export interface OrderGroupState {
  status: OrderStatus;
  dispatchStatus: DispatchStatus | null;
  trackingNumber: string | null;
  dispatchedAt: string | null;
}

/** 서버 상태를 반영하기 위해 로컬에 적용할 변경분 */
export interface LocalStatePatch {
  status?: OrderStatus;
  dispatchStatus?: DispatchStatus;
  trackingNumber?: string;
  dispatchedAt?: string | null;
  /** 로그·집계용 분류 */
  reason: "dispatched" | "tracking";
}

/**
 * 같은 orderId 의 여러 row(상품)를 그룹 상태 1건으로 압축.
 * `dispatched`는 그룹 전체가 완료됐을 때만 인정한다 (부분 발송을 완료로 오인 방지).
 */
export function aggregateGroupState(
  rows: Array<{
    status: string;
    dispatchStatus: string | null;
    trackingNumber: string | null;
    dispatchedAt?: string | null;
  }>,
): OrderGroupState | null {
  if (rows.length === 0) return null;

  const allDispatched = rows.every((r) => r.status === "dispatched");
  const notDispatched = rows.find((r) => r.status !== "dispatched");

  const dispatchedAts = rows
    .map((r) => r.dispatchedAt)
    .filter((d): d is string => !!d)
    .sort();

  return {
    status: (allDispatched
      ? "dispatched"
      : (notDispatched?.status ?? rows[0].status)) as OrderStatus,
    dispatchStatus:
      (rows.find((r) => r.dispatchStatus)?.dispatchStatus as
        DispatchStatus | undefined) ?? null,
    trackingNumber: rows.find((r) => r.trackingNumber)?.trackingNumber ?? null,
    dispatchedAt: dispatchedAts.at(-1) ?? null,
  };
}

// ─── 네이버 원천 대조 정책 ───

/** 네이버 상품주문 1건의 발송 관점 상태 */
export interface NaverItemState {
  /** 네이버 productOrderStatus 원문 */
  productOrderStatus: string;
  trackingNumber: string | null;
  /** 네이버가 기록한 발송일 (ISO) */
  dispatchedAt: string | null;
}

/** 발송처리가 끝난 뒤에만 도달하는 네이버 상품주문 상태 */
const NAVER_DISPATCHED_STATUSES: ReadonlySet<string> = new Set([
  "DELIVERING",
  "DELIVERED",
  "PURCHASE_DECIDED",
  "EXCHANGED",
]);

/** 아직 발송 전 — 하나라도 있으면 그룹을 완료로 볼 수 없다 */
const NAVER_PRE_DISPATCH_STATUSES: ReadonlySet<string> = new Set([
  "PAYMENT_WAITING",
  "PAYED",
]);

/**
 * 네이버(발송처리의 최종 원천)가 보는 그룹 상태를 로컬 반영용으로 압축.
 *
 * 서버 DB가 모르는 그룹 — 서버 도입 이전 주문이거나 서버 DB가 초기화된 경우 —
 * 은 역동기화로 영영 정리되지 않는다. 그런 그룹의 진위는 네이버만 알고 있다.
 *
 * 판정은 보수적으로 한다. 발송 이후 상태가 하나라도 있고 **발송 전 상태가 전혀
 * 없을 때만** 완료로 본다. 취소·반품만 남은 그룹은 발송된 적이 없으므로 null.
 *
 * @returns 완료로 확정할 수 있으면 그룹 상태, 아니면 null (판단 보류 = 현상 유지)
 */
export function resolveNaverGroupDispatch(
  items: NaverItemState[],
): OrderGroupState | null {
  if (items.length === 0) return null;
  if (items.some((i) => NAVER_PRE_DISPATCH_STATUSES.has(i.productOrderStatus)))
    return null;

  const dispatched = items.filter((i) =>
    NAVER_DISPATCHED_STATUSES.has(i.productOrderStatus),
  );
  if (dispatched.length === 0) return null;

  const dispatchedAts = dispatched
    .map((i) => i.dispatchedAt)
    .filter((d): d is string => !!d)
    .sort();

  return {
    status: "dispatched",
    dispatchStatus: "dispatched",
    trackingNumber:
      dispatched.find((i) => i.trackingNumber)?.trackingNumber ?? null,
    dispatchedAt: dispatchedAts[0] ?? null,
  };
}

/**
 * 서버(발송 주체)의 그룹 상태를 로컬에 반영할 변경분을 계산.
 * 변경할 게 없으면 null.
 *
 * 서버는 운송장 스크래핑·네이버 발송처리의 단독 주체이므로 발송 관련 필드는
 * 항상 서버가 진실이다. 반대로 로컬만 아는 정보(예약 진행/취소 등)는 건드리지 않는다.
 */
export function resolveServerStateSync(
  local: OrderGroupState,
  server: OrderGroupState,
): LocalStatePatch | null {
  const serverDispatched =
    server.status === "dispatched" || server.dispatchStatus === "dispatched";

  if (serverDispatched) {
    const trackingSettled = !server.trackingNumber || !!local.trackingNumber;
    if (
      local.status === "dispatched" &&
      local.dispatchStatus === "dispatched" &&
      trackingSettled
    ) {
      return null;
    }
    return {
      status: "dispatched",
      dispatchStatus: "dispatched",
      ...(server.trackingNumber && !local.trackingNumber
        ? { trackingNumber: server.trackingNumber }
        : {}),
      dispatchedAt: server.dispatchedAt,
      reason: "dispatched",
    };
  }

  // 서버가 운송장을 잡았지만 아직 발송 전(또는 발송 실패) — 운송장·발송상태만 반영.
  // 발송 실패(dispatch_failed)도 이 경로: 발송 시도에는 운송장이 반드시 있다.
  if (server.trackingNumber) {
    const nextDispatchStatus: DispatchStatus =
      server.dispatchStatus ?? "pending_dispatch";
    if (
      local.status === "booked" &&
      local.trackingNumber === server.trackingNumber &&
      local.dispatchStatus === nextDispatchStatus
    ) {
      return null;
    }
    return {
      status: "booked",
      dispatchStatus: nextDispatchStatus,
      trackingNumber: server.trackingNumber,
      reason: "tracking",
    };
  }

  return null;
}
