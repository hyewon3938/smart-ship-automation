import { NextResponse } from "next/server";

import { loginDirect } from "@/lib/gs-delivery/login-session";

/** POST /api/gs-login — 로컬 Playwright 브라우저에서 직접 GS택배 로그인 */
export async function POST() {
  const result = await loginDirect();
  return NextResponse.json(result);
}
