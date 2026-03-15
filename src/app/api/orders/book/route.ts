import { NextRequest, NextResponse } from "next/server";

import { bookOrders, getOrdersByIds } from "@/lib/orders";
import { groupOrdersByOrderId } from "@/lib/groupOrders";
import { enqueueBookings } from "@/lib/gs-delivery/worker";

import type { BookingTask } from "@/lib/gs-delivery/types";

export async function POST(request: NextRequest) {
  try {
    const { orderIds } = await request.json();

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { error: "예약할 주문 ID 목록이 필요합니다" },
        { status: 400 }
      );
    }

    // 1. 상태 → booking (전체 상품)
    const result = bookOrders(orderIds);

    // 2. orderId 기준 그룹화 → 1그룹 = 1건 택배 예약
    const targetOrders = getOrdersByIds(orderIds);
    const groups = groupOrdersByOrderId(targetOrders);

    const tasks: BookingTask[] = groups.map((group) => ({
      orderDbIds: group.orders.map((o) => o.id),
      naverOrderId: group.orderId,
      recipientName: group.recipientName,
      recipientPhone: group.recipientPhone,
      recipientAddress: group.recipientAddress,
      recipientAddressDetail: group.recipientAddressDetail,
      recipientZipCode: group.recipientZipCode,
      deliveryType: group.orders[0].selectedDeliveryType as "domestic" | "nextDay",
      totalPrice: group.orders.reduce((sum, o) => sum + (o.totalPrice ?? 0), 0),
      shippingMemo: group.shippingMemo,
    }));

    enqueueBookings(tasks);

    return NextResponse.json({
      message: `${groups.length}건 예약이 시작되었습니다`,
      count: result.count,
      groupCount: groups.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
