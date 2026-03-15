import { NextRequest, NextResponse } from "next/server";

import { updateGroupDeliveryType, updateGroupStatus } from "@/lib/orders";

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, status, deliveryType } = body;

    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json(
        { error: "주문번호가 필요합니다" },
        { status: 400 }
      );
    }

    if (status) {
      updateGroupStatus(orderId, status);
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
