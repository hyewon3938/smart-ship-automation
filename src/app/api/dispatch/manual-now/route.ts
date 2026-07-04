import { NextResponse } from "next/server";

import { scrapeTrackingNumbers } from "@/lib/gs-delivery/scrape-tracking";
import { probeGsSession } from "@/lib/gs-delivery/session";
import { maskId } from "@/lib/log-mask";
import {
  getBookedOrderGroups,
  markOrderGroupAsDispatched,
  updateTrackingNumbers,
} from "@/lib/orders";
import { syncDispatchNow } from "@/lib/sync-to-server";

/**
 * POST /api/dispatch/manual-now — 로컬 전용 "지금 발송처리" 오케스트레이터.
 *
 * 스크래핑 윈도우(8~18시) 밖이나 GS 세션 만료 상황에서 버튼 하나로:
 *   1) 세션 실측 확인 (만료 시 needLogin 반환 → 프론트가 로그인 트리거)
 *   2) booked 주문 운송장 스크래핑 (윈도우 게이트 우회)
 *   3) 서버로 넘겨 즉시 발송 (서버가 단독 발송 주체)
 *   4) 서버가 발송한 건은 로컬 DB도 dispatched로 정리
 *
 * 2026-07-04 저녁 7건을 수동으로 처리한 흐름을 그대로 코드화한 것 (ADR-0003).
 */
export async function POST() {
  if (process.env.DEPLOY_MODE === "server") {
    return NextResponse.json(
      { error: "로컬 전용 기능입니다" },
      { status: 400 },
    );
  }

  try {
    // 1. GS 세션 실측 (파일 나이가 아닌 live 프로브)
    const alive = await probeGsSession();
    if (!alive) {
      return NextResponse.json({
        ok: false,
        needLogin: true,
        message: "GS택배 세션이 만료되었습니다. 로그인이 필요합니다.",
      });
    }

    // 2. booked + 예약번호 있고 운송장 아직 없는 그룹만 대상
    const groups = getBookedOrderGroups().filter(
      (g) => g.bookingReservationNo && !g.trackingNumber,
    );
    if (groups.length === 0) {
      return NextResponse.json({
        ok: true,
        scraped: 0,
        dispatched: 0,
        pending: 0,
        message: "발송 대기 중인 주문이 없습니다",
      });
    }

    // 예약번호 → orderId 역매핑
    const resvToOrder = new Map<string, string>();
    for (const g of groups) {
      if (g.bookingReservationNo) {
        resvToOrder.set(g.bookingReservationNo, g.orderId);
      }
    }

    // 3. 운송장 스크래핑 (scrapeTrackingNumbers는 윈도우 게이트가 없어 직접 호출 = 윈도우 우회)
    let items: Array<{ orderId: string; trackingNumber: string }>;
    try {
      const scraped = await scrapeTrackingNumbers([...resvToOrder.keys()]);
      items = scraped.flatMap((s) => {
        const orderId = resvToOrder.get(s.reservationNo);
        if (!orderId || !s.trackingNo) return [];
        return [{ orderId, trackingNumber: s.trackingNo }];
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "스크래핑 실패";
      // 프로브 직후이지만 방어적으로 — 세션 만료 메시지면 로그인 유도
      if (msg.includes("만료")) {
        return NextResponse.json({ ok: false, needLogin: true, message: msg });
      }
      return NextResponse.json({ ok: false, message: msg }, { status: 502 });
    }

    if (items.length === 0) {
      return NextResponse.json({
        ok: true,
        scraped: 0,
        dispatched: 0,
        pending: groups.length,
        message: "운송장이 아직 배정되지 않았습니다 (GS에 미표시)",
      });
    }

    // 4. 서버로 넘겨 즉시 발송 (서버가 단독 발송 주체)
    const serverRes = await syncDispatchNow(items);
    if (!serverRes) {
      // 로컬 DB는 건드리지 않는다 → 다음 클릭에서 깨끗하게 재스크래핑·재시도
      return NextResponse.json({
        ok: false,
        scraped: items.length,
        dispatched: 0,
        message: "서버 발송 요청에 실패했습니다 (서버 연결/동기화 오류)",
      });
    }

    // 5. 로컬 DB 반영: 운송장 표시 + 서버가 발송한 건 dispatched로 정리
    for (const it of items) {
      updateTrackingNumbers(it.orderId, it.trackingNumber);
    }
    for (const orderId of serverRes.dispatched) {
      markOrderGroupAsDispatched(orderId);
      console.log(`[dispatch/manual-now] 발송 완료 — ${maskId(orderId)}`);
    }

    return NextResponse.json({
      ok: true,
      scraped: items.length,
      dispatched: serverRes.dispatched.length,
      failed: serverRes.failed,
      pending: groups.length - items.length,
      message: `발송 ${serverRes.dispatched.length}건 완료`,
    });
  } catch (error) {
    console.error("[dispatch/manual-now] 처리 실패:", error);
    return NextResponse.json(
      { ok: false, message: "발송처리 중 오류가 발생했습니다" },
      { status: 500 },
    );
  }
}
