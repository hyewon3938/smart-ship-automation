import { NextRequest, NextResponse } from "next/server";

import { dispatchOrders, DELIVERY_COMPANY_CODES } from "@/lib/naver/dispatch";
import {
  addBookingLog,
  getBookedOrderGroups,
  updateDispatchStatus,
} from "@/lib/orders";
import { getNextDayDeliveryCode } from "@/lib/settings";

/** POST /api/dispatch — 특정 주문 그룹 수동 발송처리 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { orderId?: string };
    const { orderId } = body;
    if (!orderId) {
      return NextResponse.json({ error: "orderId가 필요합니다" }, { status: 400 });
    }

    const groups = getBookedOrderGroups();
    const group = groups.find((g) => g.orderId === orderId);
    if (!group) {
      return NextResponse.json(
        { error: "해당 주문을 찾을 수 없거나 booked 상태가 아닙니다" },
        { status: 404 }
      );
    }
    if (!group.trackingNumber) {
      return NextResponse.json(
        { error: "운송장번호가 아직 없습니다. 먼저 운송장 동기화를 실행하세요." },
        { status: 400 }
      );
    }

    const deliveryCompanyCode =
      group.deliveryType === "nextDay"
        ? getNextDayDeliveryCode()
        : DELIVERY_COMPANY_CODES.domestic;

    const result = await dispatchOrders({
      productOrderIds: group.productOrderIds,
      deliveryCompanyCode,
      trackingNumber: group.trackingNumber,
    });

    if (result.success) {
      updateDispatchStatus(orderId, "dispatched");
      addBookingLog(
        group.firstDbId,
        "dispatch",
        `네이버 발송처리 완료: ${group.trackingNumber}`
      );
      return NextResponse.json({ message: "발송처리 완료", orderId });
    }

    updateDispatchStatus(orderId, "dispatch_failed");
    addBookingLog(
      group.firstDbId,
      "error",
      `발송처리 실패: ${result.error}`
    );
    return NextResponse.json(
      { error: result.error ?? "발송처리 실패" },
      { status: 500 }
    );
  } catch (error) {
    console.error("발송처리 실패:", error);
    return NextResponse.json(
      { error: "발송처리 중 오류가 발생했습니다" },
      { status: 500 }
    );
  }
}
