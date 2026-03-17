import { NextRequest, NextResponse } from "next/server";

import { verifySessionToken, COOKIE_NAME } from "@/lib/auth";

/** 인증 없이 접근 가능한 경로 패턴 */
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/",
  "/api/internal/", // local↔server 동기화 (x-api-key 인증)
  "/_next/",
  "/icons/",
  "/manifest.json",
  "/sw.js",
  "/favicon.ico",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) =>
    p.endsWith("/") ? pathname.startsWith(p) : pathname === p
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const payload = await verifySessionToken(token);
  if (!payload) {
    // 만료 또는 잘못된 토큰 — 쿠키 삭제 후 로그인 페이지로
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete(COOKIE_NAME);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
