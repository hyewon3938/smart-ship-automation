import { NextRequest, NextResponse } from "next/server";

import { bookOrders, getOrdersByIds } from "@/lib/orders";
import { groupOrdersByOrderId } from "@/lib/groupOrders";
import { enqueueVisitPickup } from "@/lib/gs-delivery/worker";

import type { VisitPickupRecipient, VisitPickupTask } from "@/lib/gs-delivery/types";

const MIN_VISIT_PICKUP_COUNT = 2;

export async function POST(request: NextRequest) {
  try {
    const { orderIds } = await request.json();

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { error: "예약할 주문 ID 목록이 필요합니다" },
        { status: 400 }
      );
    }

    // 1. orderId 기준 그룹화 → 최소 건수 검증 (상태 변경 전에 수행)
    const targetOrders = getOrdersByIds(orderIds);
    const groups = groupOrdersByOrderId(targetOrders);

    if (groups.length < MIN_VISIT_PICKUP_COUNT) {
      return NextResponse.json(
        { error: `방문택배는 최소 ${MIN_VISIT_PICKUP_COUNT}건 이상 선택해야 합니다 (현재 ${groups.length}건)` },
        { status: 400 }
      );
    }

    // 2. 검증 통과 후 상태 → booking
    bookOrders(orderIds);

    // 3. 수령인 목록 생성
    const recipients: VisitPickupRecipient[] = groups.map((group) => ({
      orderDbIds: group.orders.map((o) => o.id),
      naverOrderId: group.orderId,
      recipientName: group.recipientName,
      recipientPhone: group.recipientPhone,
      recipientAddress: group.recipientAddress,
      recipientAddressDetail: group.recipientAddressDetail,
      recipientZipCode: group.recipientZipCode,
    }));

    // 4. 물품 가액: 첫 번째 그룹의 합계 (택배 1건 기준)
    const unitPrice = groups[0].orders.reduce(
      (sum, o) => sum + (o.totalPrice ?? 0),
      0
    );

    const task: VisitPickupTask = {
      allOrderDbIds: orderIds,
      recipients,
      unitPrice,
    };

    // 5. 방문택배 처리 시작
    void enqueueVisitPickup(task);

    return NextResponse.json({
      message: `방문택배 ${groups.length}건 폼 입력을 시작합니다`,
      groupCount: groups.length,
      productCount: orderIds.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
