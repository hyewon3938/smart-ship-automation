import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

/**
 * 내부 동기화 API (로컬↔서버)용 x-api-key 헤더 검증.
 * 일치하지 않으면 401 응답을, 통과하면 null을 반환.
 */
export function verifyInternalApiKey(
  request: NextRequest
): NextResponse | null {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) {
    throw new Error(
      "INTERNAL_API_KEY 환경 변수가 설정되지 않았습니다. .env.local 확인 필요."
    );
  }

  const provided = request.headers.get("x-api-key");
  if (!provided) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);

  if (providedBuf.length !== expectedBuf.length) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!timingSafeEqual(providedBuf, expectedBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
