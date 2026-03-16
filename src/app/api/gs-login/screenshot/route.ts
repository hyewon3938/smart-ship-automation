import { NextResponse } from "next/server";

import { getScreenshot, hasActiveSession } from "@/lib/gs-delivery/login-session";

/** GET /api/gs-login/screenshot — 현재 로그인 페이지 스크린샷 */
export async function GET() {
  if (!hasActiveSession()) {
    return NextResponse.json(
      { success: false, message: "활성 로그인 세션이 없습니다." },
      { status: 404 }
    );
  }

  const result = await getScreenshot();
  return NextResponse.json(result);
}
