import { NextResponse } from "next/server";

import { checkCookieValidity } from "@/lib/gs-delivery/login-session";

/** GET /api/gs-login/status — GS택배 쿠키 유효성 확인 */
export async function GET() {
  const result = checkCookieValidity();
  return NextResponse.json(result);
}
