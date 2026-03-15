import { NextRequest, NextResponse } from "next/server";

import { bookOrders, getOrdersByIds } from "@/lib/orders";
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

    // 1. 상태 → booking (기존 로직)
    const result = bookOrders(orderIds);

    // 2. 워커에 예약 작업 전달 (비동기, 즉시 반환)
    const targetOrders = getOrdersByIds(orderIds);
    const tasks: BookingTask[] = targetOrders.map((order) => ({
      orderId: order.id,
      recipientName: order.recipientName,
      recipientPhone: order.recipientPhone,
      recipientAddress: order.recipientAddress,
      recipientAddressDetail: order.recipientAddressDetail ?? null,
      recipientZipCode: order.recipientZipCode,
      deliveryType: order.selectedDeliveryType as "domestic" | "nextDay",
      productName: order.productName,
      totalPrice: order.totalPrice ?? 0,
      quantity: order.quantity,
      shippingMemo: order.shippingMemo ?? null,
    }));

    enqueueBookings(tasks);

    return NextResponse.json({
      message: `${result.count}건 예약이 시작되었습니다`,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
