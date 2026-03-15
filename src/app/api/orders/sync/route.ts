import { NextResponse } from "next/server";

import { syncOrders } from "@/lib/naver/sync";
import { setSetting } from "@/lib/settings";

export async function POST() {
  try {
    const result = await syncOrders();
    setSetting("lastSyncTime", new Date().toISOString());

    return NextResponse.json({
      message: "동기화 완료",
      ...result,
    });
  } catch (error) {
    console.error("주문 동기화 실패:", error);

    const message =
      error instanceof Error ? error.message : "알 수 없는 오류";

    return NextResponse.json(
      { error: `주문 동기화에 실패했습니다: ${message}` },
      { status: 500 }
    );
  }
}
