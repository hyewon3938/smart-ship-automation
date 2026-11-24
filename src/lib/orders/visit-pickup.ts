import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { maskId } from "@/lib/log-mask";

import { addBookingLog } from "./booking-logs";

import type { VisitDispatchInfo } from "@/lib/gs-delivery/types";
import type { DispatchStatus, OrderStatus } from "@/types";

// ─── 방문택배 자동 발송처리 (ADR-0001 참조) ───

/** 방문택배 매칭 대기 중인 그룹 1건 */
export interface VisitPickupGroup {
  orderId: string;
  /** 그룹 내 첫 row id (로그/로그테이블 키 용도) */
  firstDbId: number;
  /** 그룹 내 모든 row id (status 일괄 업데이트에 사용) */
  allDbIds: number[];
  recipientZipCode: string;
  recipientPhone: string;
}

/**
 * booking 상태이면서 방문택배인 그룹 조회 (dispatch-worker 매칭 대상).
 *
 * 사용자가 폼 입력 + 직접 결제까지 끝낸 후 status="booking" 상태로 멈춰 있다가,
 * 폴링이 GS 예약list에서 운송장을 매칭하면 status="booked"로 전이된다.
 */
export function getBookingVisitPickupGroups(): VisitPickupGroup[] {
  const rows = db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.status, "booking" as OrderStatus),
        eq(orders.selectedDeliveryType, "visit"),
      ),
    )
    .all();

  const groupMap = new Map<string, typeof rows>();
  for (const r of rows) {
    const existing = groupMap.get(r.orderId) ?? [];
    existing.push(r);
    groupMap.set(r.orderId, existing);
  }

  return Array.from(groupMap.entries()).map(([orderId, items]) => ({
    orderId,
    firstDbId: items[0].id,
    allDbIds: items.map((i) => i.id),
    recipientZipCode: items[0].recipientZipCode,
    recipientPhone: items[0].recipientPhone,
  }));
}

/**
 * orderIds 그룹의 selectedDeliveryType을 "visit"으로 마킹.
 * book-visit 라우트에서 bookOrders 직후 호출 — 이후 폴링이 visit 그룹을 추적.
 */
export function markAsVisitPickup(orderIds: number[]): void {
  if (orderIds.length === 0) return;
  db.update(orders)
    .set({
      selectedDeliveryType: "visit",
      updatedAt: new Date().toISOString(),
    })
    .where(inArray(orders.id, orderIds))
    .run();
}

/**
 * 방문택배 스크래핑 결과를 booking 상태 그룹에 매핑 적용.
 *
 * 매칭 키: (recipientZipCode, recipientPhone 끝 4자리). 매칭된 그룹은
 *   - bookingReservationNo = 스크래핑한 GS 예약번호
 *   - trackingNumber       = 상세페이지의 운송장번호
 *   - dispatchStatus       = "pending_dispatch"
 *   - status               = "booked"
 * 로 업데이트되어 다음 폴링에서 일반택배와 같은 dispatch 흐름을 탄다.
 *
 * 매칭 안 된 line/group은 그대로 두어 다음 폴링에서 재시도된다.
 */
export function applyVisitDispatchInfo(infos: VisitDispatchInfo[]): {
  matched: number;
  unmatched: number;
  reservations: string[];
} {
  if (infos.length === 0) {
    return { matched: 0, unmatched: 0, reservations: [] };
  }

  const groups = getBookingVisitPickupGroups();
  const keyToGroup = new Map<string, VisitPickupGroup>();
  for (const g of groups) {
    const key = makeVisitMatchKey(g.recipientZipCode, g.recipientPhone);
    if (!key) continue;
    if (keyToGroup.has(key)) {
      // 동일 (zip+last4) 그룹이 둘 이상 — 매칭 모호. 경고만 남기고 skip
      console.warn(
        `[orders] 방문택배 매칭 키 충돌 — ${key} (orderId: ${maskId(g.orderId)})`,
      );
      continue;
    }
    keyToGroup.set(key, g);
  }

  const now = new Date().toISOString();
  let matched = 0;
  let unmatched = 0;
  const matchedReservations = new Set<string>();

  for (const info of infos) {
    for (const line of info.recipients) {
      const key = `${line.zipCode}:${line.phoneLast4}`;
      const group = keyToGroup.get(key);
      if (!group) {
        unmatched++;
        continue;
      }

      db.update(orders)
        .set({
          status: "booked" as OrderStatus,
          bookingReservationNo: info.reservationNo,
          trackingNumber: line.trackingNo,
          dispatchStatus: "pending_dispatch" as DispatchStatus,
          bookedAt: sql`COALESCE(${orders.bookedAt}, ${now})`,
          updatedAt: now,
        })
        .where(inArray(orders.id, group.allDbIds))
        .run();

      addBookingLog(
        group.firstDbId,
        "tracking",
        `방문택배 매칭: 예약 ${info.reservationNo}, 운송장 ${line.trackingNo}`,
      );

      matched++;
      matchedReservations.add(info.reservationNo);
      // 한 그룹은 한 번만 매칭 — 다른 line으로 재매칭 방지
      keyToGroup.delete(key);
    }
  }

  return {
    matched,
    unmatched,
    reservations: Array.from(matchedReservations),
  };
}

/**
 * 방문택배 타입 + 이미 GS 예약번호가 매핑된(=매칭 완료) 주문의 reservationNo 집합.
 *
 * 폴링이 scrapeVisitPickup을 호출할 때 이 집합을 knownReservationNos로 넘기면,
 * 이미 매칭 완료된 예약의 GS 상세페이지를 다시 fetch하지 않는다.
 * (PR #60 이후 dispatch-worker가 빈 배열로 호출 → GS 봇 감지 트리거 → 세션 조기 만료
 *   되던 문제 해결용 헬퍼. 같은 폴링 사이클에서 반복 fetch 방지가 핵심.)
 */
export function getMatchedVisitReservationNos(): string[] {
  const rows = db
    .select({ no: orders.bookingReservationNo })
    .from(orders)
    .where(
      and(
        eq(orders.selectedDeliveryType, "visit"),
        isNotNull(orders.bookingReservationNo),
      ),
    )
    .all();

  return Array.from(
    new Set(rows.map((r) => r.no).filter((n): n is string => !!n)),
  );
}

/**
 * 방문택배 매칭 키 생성.
 * - zipCode: 5자리 숫자 검증 후 그대로
 * - phone:   숫자만 남기고 끝 4자리 추출
 * 형식이 어긋나면 null 반환 (해당 그룹은 매칭에서 제외).
 */
function makeVisitMatchKey(zipCode: string, phone: string): string | null {
  const z = zipCode.trim();
  if (!/^\d{5}$/.test(z)) return null;
  const digits = phone.replace(/\D/g, "");
  const last4 = digits.match(/(\d{4})$/);
  if (!last4) return null;
  return `${z}:${last4[1]}`;
}
