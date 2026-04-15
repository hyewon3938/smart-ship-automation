import fs from "fs";
import path from "path";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { verifyInternalApiKey } from "@/lib/internal-auth";

const COOKIES_PATH = path.join(process.cwd(), "data", "cookies.json");

const bodySchema = z.object({
  cookies: z.array(z.record(z.string(), z.unknown())).min(1),
});

/** POST /api/internal/cookies — 로컬에서 GS택배 쿠키 수신 후 저장 */
export async function POST(request: NextRequest) {
  const unauthorized = verifyInternalApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "요청 형식이 올바르지 않습니다" },
        { status: 400 }
      );
    }
    const { cookies } = parsed.data;

    const dir = path.dirname(COOKIES_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));

    console.log(
      `[internal/cookies] GS택배 쿠키 저장 완료 (${cookies.length}개)`
    );
    return NextResponse.json({
      message: `쿠키 ${cookies.length}개 저장 완료`,
    });
  } catch (error) {
    console.error("[internal/cookies] 저장 실패:", error);
    return NextResponse.json(
      { error: "쿠키 저장 중 오류가 발생했습니다" },
      { status: 500 }
    );
  }
}
