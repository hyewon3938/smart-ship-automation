import { NextRequest, NextResponse } from "next/server";

import { verifyInternalApiKey } from "@/lib/internal-auth";
import {
  addBookingLogByOrderId,
  updateOrdersByOrderId,
  upsertOrdersFromLocal,
} from "@/lib/orders";

import type { OrderStatus } from "@/types";

interface OrderItem {
  productOrderId: string;
  orderDate: string;
  productName: string;
  quantity: number;
  optionInfo: string | null;
  totalPrice: number | null;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  recipientAddressDetail: string | null;
  recipientZipCode: string;
  shippingMemo: string | null;
  isNextDayEligible: boolean;
  selectedDeliveryType: "domestic" | "nextDay";
}

/** POST /api/internal/booking-result — 로컬 예약 결과 수신 후 서버 DB 업데이트 (없으면 INSERT) */
export async function POST(request: NextRequest) {
  const unauthorized = verifyInternalApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const body = (await request.json()) as {
      orderId: string;
      status: OrderStatus;
      bookingResult?: string;
      bookingReservationNo?: string;
      error?: string;
      orderItems?: OrderItem[];
    };

    if (!body.orderId || !body.status) {
      return NextResponse.json(
        { error: "orderId와 status가 필요합니다" },
        { status: 400 }
      );
    }

    if (body.status === "booked") {
      // orderItems가 있으면 upsert (서버 DB에 없는 주문도 INSERT)
      if (body.orderItems && body.orderItems.length > 0) {
        upsertOrdersFromLocal(
          body.orderId,
          body.orderItems,
          body.bookingResult,
          body.bookingReservationNo
        );
      } else {
        // orderItems 없으면 기존 방식 (UPDATE only)
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
