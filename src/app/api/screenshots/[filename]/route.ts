import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { NextRequest, NextResponse } from "next/server";

const SCREENSHOTS_DIR = join(process.cwd(), "data", "screenshots");

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // 경로 조작 방지
  if (filename.includes("..") || filename.includes("/")) {
    return NextResponse.json({ error: "잘못된 파일명" }, { status: 400 });
  }

  const filepath = join(SCREENSHOTS_DIR, filename);
  if (!existsSync(filepath)) {
    return NextResponse.json({ error: "파일 없음" }, { status: 404 });
  }

  const buffer = readFileSync(filepath);
  return new NextResponse(buffer, {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" },
  });
}
