import { NextRequest, NextResponse } from "next/server";

import { forwardClick, hasActiveSession } from "@/lib/gs-delivery/login-session";

/** POST /api/gs-login/click — 클릭 좌표 전달 */
export async function POST(request: NextRequest) {
  if (!hasActiveSession()) {
    return NextResponse.json(
      { success: false, message: "활성 로그인 세션이 없습니다." },
      { status: 404 }
    );
  }

  const body = await request.json();
  const { x, y } = body as { x: number; y: number };

  if (typeof x !== "number" || typeof y !== "number") {
    return NextResponse.json(
      { success: false, message: "x, y 좌표가 필요합니다." },
      { status: 400 }
    );
  }

  const result = await forwardClick(x, y);
  return NextResponse.json(result);
}
