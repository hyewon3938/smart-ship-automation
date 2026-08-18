/**
 * 네이버 원천 대조 — 서버가 모르는 "묵은 예약완료" 그룹 정리.
 *
 * 역동기화(ADR-0005)는 서버 DB에 기록이 있는 그룹만 정리할 수 있다. 서버 도입
 * 이전에 예약했거나 서버 DB가 초기화된 그룹은 서버가 `{states: []}`로 답하므로
 * 로컬에 "예약완료"로 영원히 남는다. 실제로 발송됐는지는 네이버만 알고 있다.
 *
 * 네이버 API 호출이 붙으므로 2분 주기 폴링이 아니라 **사용자가 동기화를 누를 때**만
 * 돈다. 대상도 하루 이상 묵고 운송장조차 없는 그룹으로 좁힌다 — 정상 흐름의 주문은
 * 여기까지 오지 않는다.
 */

import { resolveNaverGroupDispatch } from "@/lib/order-lifecycle";

import type { NaverItemState } from "@/lib/order-lifecycle";

export interface NaverReconcileResult {
  /** 대조한 그룹 수 */
  checked: number;
  /** 발송완료로 정리한 그룹 수 */
  dispatched: number;
}

export async function reconcileStaleFromNaver(): Promise<NaverReconcileResult> {
  // 순환 참조 방지를 위해 동적 import (orders.ts → naver/* 방향 의존이 이미 있음)
  const { getStaleBookedProductOrders, applyServerGroupState } =
    await import("@/lib/orders");

  const stale = getStaleBookedProductOrders();
  if (stale.length === 0) return { checked: 0, dispatched: 0 };

  const { fetchProductOrderStates } = await import("./orders");
  const states = await fetchProductOrderStates(
    stale.map((s) => s.productOrderId),
  );

  // orderId(그룹) 단위로 묶어서 판정 — 부분 발송을 완료로 오인하지 않기 위함
  const byOrderId = new Map<string, NaverItemState[]>();
  for (const { orderId, productOrderId } of stale) {
    const state = states.get(productOrderId);
    if (!state) continue; // 네이버가 모르는 항목 → 판단 보류
    byOrderId.set(orderId, [...(byOrderId.get(orderId) ?? []), state]);
  }

  let dispatched = 0;
  for (const [orderId, items] of byOrderId) {
    const groupState = resolveNaverGroupDispatch(items);
    if (!groupState) continue;
    if (applyServerGroupState(orderId, groupState, "네이버") === "dispatched") {
      dispatched++;
    }
  }

  if (dispatched > 0) {
    console.log(
      `[naver] 원천 대조 — 묵은 예약완료 ${dispatched}건을 발송완료로 정리 (대조 ${byOrderId.size}그룹)`,
    );
  }

  return { checked: byOrderId.size, dispatched };
}
