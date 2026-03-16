import { NextResponse } from "next/server";

import { _resetTokenCache, getAccessToken } from "@/lib/naver/auth";

export async function POST() {
  try {
    _resetTokenCache();
    const token = await getAccessToken();
    return NextResponse.json({
      success: true,
      message: "네이버 API 연결 성공",
      tokenPreview: token.slice(0, 8) + "...",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ success: false, message: msg }, { status: 400 });
  }
}
