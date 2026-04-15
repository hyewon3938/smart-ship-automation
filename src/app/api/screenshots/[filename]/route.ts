import { existsSync, readFileSync } from "fs";
import { extname, join, resolve, sep } from "path";

import { NextRequest, NextResponse } from "next/server";

const SCREENSHOTS_DIR = join(process.cwd(), "data", "screenshots");

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

/** 요청된 filename을 정규화해 안전한 절대 경로를 반환. 허용 범위를 벗어나면 null. */
export function resolveScreenshotPath(filename: string): string | null {
  if (
    !filename ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("..") ||
    filename.includes("\0")
  ) {
    return null;
  }

  const ext = extname(filename).toLowerCase();
  if (!(ext in CONTENT_TYPE_BY_EXT)) return null;

  const resolved = resolve(SCREENSHOTS_DIR, filename);
  if (!resolved.startsWith(SCREENSHOTS_DIR + sep)) return null;

  return resolved;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  const filepath = resolveScreenshotPath(filename);
  if (!filepath) {
    return NextResponse.json({ error: "잘못된 파일명" }, { status: 400 });
  }
  if (!existsSync(filepath)) {
    return NextResponse.json({ error: "파일 없음" }, { status: 404 });
  }

  const ext = extname(filepath).toLowerCase();
  const buffer = readFileSync(filepath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
