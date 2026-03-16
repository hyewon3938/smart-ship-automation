import { NextRequest, NextResponse } from "next/server";

import {
  addBookingLogByOrderId,
  updateOrdersByOrderId,
} from "@/lib/orders";

import type { OrderStatus } from "@/types";

/** POST /api/internal/booking-result — 로컬 예약 결과 수신 후 서버 DB 업데이트 */
export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      orderId: string;
      status: OrderStatus;
      bookingResult?: string;
      bookingReservationNo?: string;
      error?: string;
    };

    if (!body.orderId || !body.status) {
      return NextResponse.json(
        { error: "orderId와 status가 필요합니다" },
        { status: 400 }
      );
    }

    if (body.status === "booked") {
      updateOrdersByOrderId(
        body.orderId,
        "booked",
        body.bookingResult,
        body.bookingReservationNo
      );
      addBookingLogByOrderId(
        body.orderId,
        "complete",
        `예약 완료 (로컬 동기화)${body.bookingReservationNo ? `: ${body.bookingReservationNo}` : ""}`
      );
    } else if (body.status === "failed") {
      updateOrdersByOrderId(body.orderId, "failed", body.error);
      addBookingLogByOrderId(
        body.orderId,
        "error",
        `예약 실패 (로컬 동기화): ${body.error ?? "알 수 없는 오류"}`
      );
    }

    console.log(
      `[internal/booking-result] ${body.orderId}: ${body.status}` +
        (body.bookingReservationNo
          ? ` (예약번호: ${body.bookingReservationNo})`
          : "")
    );

    return NextResponse.json({ message: "동기화 완료", orderId: body.orderId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
