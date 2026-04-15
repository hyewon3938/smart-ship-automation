import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { verifyInternalApiKey } from "@/lib/internal-auth";
import {
  addBookingLogByOrderId,
  updateOrdersByOrderId,
  upsertOrdersFromLocal,
} from "@/lib/orders";

const orderItemSchema = z.object({
  productOrderId: z.string().min(1),
  orderDate: z.string(),
  productName: z.string(),
  quantity: z.number(),
  optionInfo: z.string().nullable(),
  totalPrice: z.number().nullable(),
  recipientName: z.string(),
  recipientPhone: z.string(),
  recipientAddress: z.string(),
  recipientAddressDetail: z.string().nullable(),
  recipientZipCode: z.string(),
  shippingMemo: z.string().nullable(),
  isNextDayEligible: z.boolean(),
  selectedDeliveryType: z.enum(["domestic", "nextDay"]),
});

const bodySchema = z.object({
  orderId: z.string().min(1),
  status: z.enum([
    "pending",
    "booking",
    "booked",
    "failed",
    "skipped",
    "dispatched",
  ]),
  bookingResult: z.string().optional(),
  bookingReservationNo: z.string().optional(),
  error: z.string().optional(),
  orderItems: z.array(orderItemSchema).optional(),
});

/** POST /api/internal/booking-result — 로컬 예약 결과 수신 후 서버 DB 업데이트 (없으면 INSERT) */
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
    const body = parsed.data;

    if (body.status === "booked") {
      if (body.orderItems && body.orderItems.length > 0) {
        upsertOrdersFromLocal(
          body.orderId,
          body.orderItems,
          body.bookingResult,
          body.bookingReservationNo
        );
      } else {
        updateOrdersByOrderId(
          body.orderId,
          "booked",
          body.bookingResult,
          body.bookingReservationNo
        );
      }
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
          : "") +
        (body.orderItems ? ` [upsert ${body.orderItems.length}건]` : "")
    );

    return NextResponse.json({ message: "동기화 완료", orderId: body.orderId });
  } catch (error) {
    console.error("[internal/booking-result] 처리 실패:", error);
    return NextResponse.json(
      { error: "예약 결과 동기화 중 오류가 발생했습니다" },
      { status: 500 }
    );
  }
}
