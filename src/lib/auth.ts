/**
 * 앱 레벨 JWT 인증.
 * Edge Runtime 호환을 위해 jose 라이브러리 사용 (middleware에서 import).
 */

import { SignJWT, jwtVerify } from "jose";

const authSecret = process.env.AUTH_SECRET;
if (!authSecret) {
  throw new Error(
    "AUTH_SECRET 환경 변수가 설정되지 않았습니다. .env.local 확인 필요."
  );
}
const SECRET = new TextEncoder().encode(authSecret);

export const COOKIE_NAME = "smart-ship-session";

/** 세션 최대 유지 시간: 30일 (초 단위) */
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

/** JWT 세션 토큰 생성 */
export async function createSessionToken(username: string): Promise<string> {
  return new SignJWT({ sub: username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(SECRET);
}

/** JWT 세션 토큰 검증 (유효하면 payload 반환, 아니면 null) */
export async function verifySessionToken(
  token: string
): Promise<{ sub: string } | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET, {
      algorithms: ["HS256"],
    });
    return payload as { sub: string };
  } catch {
    return null;
  }
}
