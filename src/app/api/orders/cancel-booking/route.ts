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
    console.error("[cancel-booking] 실패:", error);
    return NextResponse.json(
      { error: "예약 취소 중 오류가 발생했습니다" },
      { status: 500 }
    );
  }
}
