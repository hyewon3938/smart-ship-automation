import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { verifyInternalApiKey } from "@/lib/internal-auth";
import { getOrderGroupStates } from "@/lib/orders";

const bodySchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1).max(300),
});

/**
 * POST /api/internal/order-state — 서버가 보유한 주문 그룹의 발송 상태 조회 (읽기 전용).
 *
 * 로컬이 "서버가 이미 발송처리했는지"를 알 수 있는 유일한 경로.
 * 발송(운송장 스크래핑 + 네이버 발송처리)은 서버 단독 책임이므로
 * 발송 관련 필드는 항상 서버가 진실이다 (ADR-0005).
 */
export async function POST(request: NextRequest) {
  const unauthorized = verifyInternalApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "요청 형식이 올바르지 않습니다" },
        { status: 400 },
      );
    }

    const states = getOrderGroupStates(parsed.data.orderIds);
    return NextResponse.json({ states });
  } catch (error) {
    console.error("[internal/order-state] 조회 실패:", error);
    return NextResponse.json(
      { error: "주문 상태 조회 중 오류가 발생했습니다" },
      { status: 500 },
    );
  }
}
