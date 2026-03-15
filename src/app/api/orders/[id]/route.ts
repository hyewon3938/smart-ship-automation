import { NextRequest, NextResponse } from "next/server";

import { updateDeliveryType } from "@/lib/orders";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { selectedDeliveryType } = body;

    if (
      !selectedDeliveryType ||
      !["domestic", "nextDay"].includes(selectedDeliveryType)
    ) {
      return NextResponse.json(
        { error: "유효하지 않은 택배 유형입니다" },
        { status: 400 }
      );
    }

    const updated = updateDeliveryType(Number(id), selectedDeliveryType);
    return NextResponse.json({ order: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
