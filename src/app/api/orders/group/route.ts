import { NextRequest, NextResponse } from "next/server";

import {
  deleteOrderGroup,
  getGroupStatuses,
  shouldCheckServerBeforeDelete,
  updateGroupDeliveryType,
  updateGroupStatus,
} from "@/lib/orders";
import {
  reconcileFromServer,
  syncBookingResult,
  syncOrderDeletion,
} from "@/lib/sync-to-server";

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, status, deliveryType } = body;

    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json(
        { error: "주문번호가 필요합니다" },
        { status: 400 },
      );
    }

    if (status) {
      updateGroupStatus(orderId, status);

      // 수동 상태 변경도 서버에 동기화
      if (status === "booked" || status === "failed") {
        void syncBookingResult({
          orderId,
          status,
          ...(status === "failed" && { error: "수동 상태 변경" }),
        });
      }
    }

    if (deliveryType) {
      updateGroupDeliveryType(orderId, deliveryType);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * DELETE /api/orders/group?orderId=... — 주문 그룹을 앱에서 삭제.
 *
 * 대기/예약완료/실패 상태 모두 삭제 가능. hard delete 이므로 pending 주문은
 * 네이버에 발송대기로 남아 있으면 다음 동기화에서 다시 수집된다 (ADR-0005).
 *
 * 주의: GS택배 예약 자체나 네이버 주문은 취소되지 않는다 (앱 목록에서만 제거).
 *
 * 예약완료·실패 그룹은 삭제 전에 서버 상태를 먼저 확인한다. 서버가 이미
 * 발송처리했다면 삭제를 거부하고 로컬을 발송완료로 정정한다 —
 * "취소한 줄 알았는데 이미 발송됨" 상황 방지.
 */
export async function DELETE(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get("orderId");

  if (!orderId) {
    return NextResponse.json(
      { error: "주문번호가 필요합니다" },
      { status: 400 },
    );
  }

  try {
    if (shouldCheckServerBeforeDelete(orderId)) {
      const reconciled = await reconcileFromServer([orderId]);

      if (reconciled.ok && reconciled.dispatched > 0) {
        return NextResponse.json(
          {
            error:
              "서버에서 이미 발송처리된 주문입니다. 발송완료로 상태를 갱신했습니다",
          },
          { status: 409 },
        );
      }
      // 서버 연결 실패(ok=false)여도 삭제는 진행한다. 아래 syncOrderDeletion이
      // 서버 발송완료 건이면 skippedDispatched로 알려주고, 로컬은 다음
      // 역동기화에서 정정된다.
    }

    // 재동기화로 dispatched가 됐을 수 있으므로 최신 상태로 다시 판단
    if (getGroupStatuses(orderId).includes("dispatched")) {
      return NextResponse.json(
        { error: "발송완료된 주문은 삭제할 수 없습니다" },
        { status: 409 },
      );
    }

    const { deleted, recipientName } = deleteOrderGroup(orderId);

    // 서버에도 전파 (best-effort) — 남겨두면 서버 폴링이 발송처리해버린다
    void syncOrderDeletion(orderId);

    return NextResponse.json({ success: true, deleted, recipientName });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
