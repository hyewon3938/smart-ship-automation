import { NextRequest, NextResponse } from "next/server";

import {
  getAllSettings,
  updateBookingDefaults,
  updateGsSettings,
  updateNaverSettings,
  updateSenderSettings,
} from "@/lib/settings";
import type { AllSettings } from "@/types";

export async function GET() {
  try {
    const settings = getAllSettings();
    return NextResponse.json(settings);
  } catch (error) {
    console.error("설정 조회 실패:", error);
    return NextResponse.json({ error: "설정을 조회할 수 없습니다." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body: Partial<AllSettings> = await request.json();

    if (body.naver) updateNaverSettings(body.naver);
    if (body.gs) updateGsSettings(body.gs);
    if (body.sender) updateSenderSettings(body.sender);
    if (body.booking) updateBookingDefaults(body.booking);

    const updated = getAllSettings();
    return NextResponse.json(updated);
  } catch (error) {
    console.error("설정 저장 실패:", error);
    return NextResponse.json({ error: "설정을 저장할 수 없습니다." }, { status: 500 });
  }
}
