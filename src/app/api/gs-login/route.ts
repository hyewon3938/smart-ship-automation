import { NextResponse } from "next/server";

import {
  startSession,
  closeSession,
  hasActiveSession,
} from "@/lib/gs-delivery/login-session";

/** POST /api/gs-login — 원격 로그인 세션 시작 (Playwright 스크린샷 방식) */
export async function POST() {
  const result = await startSession();
  return NextResponse.json(result);
}

/** DELETE /api/gs-login — 로그인 세션 종료 */
export async function DELETE() {
  if (!hasActiveSession()) {
    return NextResponse.json({ message: "활성 세션 없음" });
  }
  await closeSession();
  return NextResponse.json({ message: "세션 종료" });
}
