import { NextResponse } from "next/server";

import { cancelBooking } from "@/lib/gs-delivery/worker";
import { recoverStuckBookings } from "@/lib/orders";

export async function POST() {
  try {
    await cancelBooking();

    // 안전장치: DB에 남아있을 수 있는 booking 상태 정리
    const recovered = recoverStuckBookings();

    return NextResponse.json({ success: true, recovered });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
