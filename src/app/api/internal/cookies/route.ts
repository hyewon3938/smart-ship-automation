import fs from "fs";
import path from "path";

import { NextRequest, NextResponse } from "next/server";

const COOKIES_PATH = path.join(process.cwd(), "data", "cookies.json");

/** POST /api/internal/cookies — 로컬에서 GS택배 쿠키 수신 후 저장 */
export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      cookies?: Array<Record<string, unknown>>;
    };

    if (!body.cookies || !Array.isArray(body.cookies)) {
      return NextResponse.json(
        { error: "cookies 배열이 필요합니다" },
        { status: 400 }
      );
    }

    const dir = path.dirname(COOKIES_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(body.cookies, null, 2));

    console.log(
      `[internal/cookies] GS택배 쿠키 저장 완료 (${body.cookies.length}개)`
    );
    return NextResponse.json({
      message: `쿠키 ${body.cookies.length}개 저장 완료`,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
