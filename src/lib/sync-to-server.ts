/**
 * 로컬 → 서버 동기화 유틸리티.
 *
 * DEPLOY_MODE=local(기본)이고 SERVER_URL + INTERNAL_API_KEY가 설정된 경우에만 동작.
 * 미설정 시 모든 함수는 즉시 false를 반환하여 기존 로컬 전용 동작을 유지한다.
 */

const getServerUrl = () => process.env.SERVER_URL;
const getApiKey = () => process.env.INTERNAL_API_KEY;

function canSync(): boolean {
  return (
    process.env.DEPLOY_MODE !== "server" &&
    !!getServerUrl() &&
    !!getApiKey()
  );
}

const MAX_RETRIES = 2;
const RETRY_DELAYS = [2000, 5000]; // ms

async function postToServer(endpoint: string, data: unknown): Promise<boolean> {
  if (!canSync()) return false;

  const url = `${getServerUrl()}${endpoint}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS[attempt - 1];
      console.log(`[sync] 재시도 ${attempt}/${MAX_RETRIES} (${delay / 1000}초 후) — ${endpoint}`);
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": getApiKey()!,
        },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(
          `[sync] 서버 동기화 실패 (${endpoint}): ${res.status} ${text.slice(0, 100)}`
        );
        continue; // 재시도
      }

      console.log(`[sync] 서버 동기화 성공: ${endpoint}`);
      return true;
    } catch (err) {
      console.warn(
        `[sync] 서버 연결 실패 (${endpoint}):`,
        err instanceof Error ? err.message : err
      );
      // 마지막 시도가 아니면 계속 재시도
    }
  }

  console.error(`[sync] 서버 동기화 최종 실패 (${MAX_RETRIES + 1}회 시도): ${endpoint}`);
  return false;
}

/** GS택배 예약 결과를 서버 DB에 동기화 (주문 데이터 포함 — 서버에 없으면 INSERT) */
export async function syncBookingResult(data: {
  orderId: string;
  status: "booked" | "failed";
  bookingResult?: string;
  bookingReservationNo?: string;
  error?: string;
}): Promise<boolean> {
  // booked 성공 시 주문 상세 데이터도 함께 전송 (서버 DB에 없을 경우 INSERT용)
  if (data.status === "booked") {
    try {
      const { getOrderDetailsByOrderId } = await import("@/lib/orders");
      const orderRows = getOrderDetailsByOrderId(data.orderId);
      if (orderRows.length > 0) {
        return postToServer("/api/internal/booking-result", {
          ...data,
          orderItems: orderRows.map((r) => ({
            productOrderId: r.productOrderId,
            orderDate: r.orderDate,
            productName: r.productName,
            quantity: r.quantity,
            optionInfo: r.optionInfo,
            totalPrice: r.totalPrice,
            recipientName: r.recipientName,
            recipientPhone: r.recipientPhone,
            recipientAddress: r.recipientAddress,
            recipientAddressDetail: r.recipientAddressDetail,
            recipientZipCode: r.recipientZipCode,
            shippingMemo: r.shippingMemo,
            isNextDayEligible: r.isNextDayEligible,
            selectedDeliveryType: r.selectedDeliveryType,
          })),
        });
      }
    } catch (err) {
      console.warn("[sync] 주문 상세 조회 실패, 기본 동기화 진행:", err);
    }
  }

  return postToServer("/api/internal/booking-result", data);
}

/** GS택배 로그인 쿠키를 서버에 동기화 (서버의 headless 스크래핑에 사용) */
export async function syncCookiesToServer(
  cookies: Array<Record<string, unknown>>
): Promise<boolean> {
  return postToServer("/api/internal/cookies", { cookies });
}

/**
 * 로컬 DB의 booked 주문을 서버에 재동기화 (멱등).
 * 예약 직후 동기화가 실패한 경우를 대비하여 큐 처리 완료 시 호출.
 */
export async function resyncBookedOrders(): Promise<number> {
  if (!canSync()) return 0;

  // 순환 참조 방지를 위해 동적 import
  const { getLocalBookedOrders } = await import("@/lib/orders");
  const bookedOrders = getLocalBookedOrders();
  let synced = 0;

  for (const order of bookedOrders) {
    if (!order.bookingReservationNo) continue;

    const success = await syncBookingResult({
      orderId: order.orderId,
      status: "booked",
      bookingResult: order.bookingResult ?? undefined,
      bookingReservationNo: order.bookingReservationNo,
    });
    if (success) synced++;
  }

  if (synced > 0) {
    console.log(
      `[sync] 재동기화 완료: ${synced}/${bookedOrders.length}건`
    );
  }
  return synced;
}

/** 운송장번호를 서버에 동기화 (로컬 스크래핑 결과 전송) */
export async function syncTrackingNumbers(
  items: Array<{ orderId: string; trackingNumber: string }>
): Promise<boolean> {
  if (items.length === 0) return true;
  return postToServer("/api/internal/tracking", { items });
}
