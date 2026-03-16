import { NextResponse } from "next/server";

import { login } from "@/lib/gs-delivery/auth";
import { newPage } from "@/lib/gs-delivery/browser";

export async function POST() {
  let page;
  try {
    page = await newPage();
    await login(page);
    return NextResponse.json({
      success: true,
      message: "GS택배 로그인 성공",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ success: false, message: msg }, { status: 400 });
  } finally {
    await page?.close().catch(() => {});
  }
}
