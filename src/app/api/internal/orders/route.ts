import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { verifyInternalApiKey } from "@/lib/internal-auth";
import { maskId } from "@/lib/log-mask";
import { deleteOrderGroup, getGroupStatuses } from "@/lib/orders";

const bodySchema = z.object({
  orderId: z.string().min(1),
});

/**
 * DELETE /api/internal/orders — 로컬에서 삭제한 주문 그룹을 서버 DB에서도 제거.
 *
 * 로컬에서만 지우면 서버 폴링이 그 주문을 계속 추적·발송처리하므로
 * "취소하려고 삭제했는데 발송됐다"가 된다. 그래서 삭제는 서버까지 전파한다.
 *
 * 이미 발송처리(dispatched)된 그룹은 서버에서 삭제하지 않고 skipped로 알린다
 * (발송 기록 보존 — 로컬은 삭제 전에 order-state로 이 상황을 먼저 걸러낸다).
 */
export async function DELETE(request: NextRequest) {
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
    const { orderId } = parsed.data;

    const statuses = getGroupStatuses(orderId);
    if (statuses.length === 0) {
      // 서버에 없는 주문 — 로컬 전용(pending) 삭제이므로 정상 응답
      return NextResponse.json({ deleted: 0, notFound: true });
    }
    if (statuses.includes("dispatched")) {
      console.warn(
        `[internal/orders] 발송완료 주문 삭제 거부 — ${maskId(orderId)}`,
      );
      return NextResponse.json({ deleted: 0, skippedDispatched: true });
    }

    const { deleted } = deleteOrderGroup(orderId);
    console.log(
      `[internal/orders] 삭제 완료 — ${maskId(orderId)} (${deleted}건)`,
    );
    return NextResponse.json({ deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    console.error("[internal/orders] 삭제 실패:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
