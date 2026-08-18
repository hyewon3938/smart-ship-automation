import { getAccessToken } from "./auth";
import {
  conditionalOrdersResponseSchema,
  splitByShippingAddress,
} from "./types";
import type { NaverItemState } from "@/lib/order-lifecycle";
import type { AwaitingAddressOrder, ProductOrderDetail } from "./types";

const BASE_URL = "https://api.commerce.naver.com/external/v1";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
/**
 * 기본 조회 기간 (일).
 *
 * 조건형 API의 from~to는 **결제일** 기준이라, 선물하기 주문처럼 결제 후 며칠 뒤에야
 * 배송지가 채워지는 건은 "수령 시점"이 아니라 여전히 결제일 창에서만 잡힌다.
 * 7일로 두면 수령이 늦은 선물 주문이 예약도 못 해본 채 창 밖으로 빠져나가므로
 * (2026-08 실제 누락), 선물 수락 기한을 덮고도 남게 14일로 잡는다.
 */
const LOOKBACK_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rate limit 대응 지수 백오프 fetch 래퍼
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
): Promise<Response> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(url, options);

    if (response.status === 429) {
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, backoff));
      continue;
    }

    return response;
  }

  throw new Error(`API 요청 실패: ${MAX_RETRIES}회 재시도 후에도 429 에러`);
}

/** 한 조회 창의 결과 — 예약 가능한 주문과 배송지 대기 주문을 함께 돌려준다 */
interface WindowResult {
  orders: ProductOrderDetail[];
  awaitingAddress: AwaitingAddressOrder[];
}

/**
 * 조건형 상품 주문 상세 내역 조회 (단일 24시간 윈도우)
 * GET /v1/pay-order/seller/product-orders
 *
 * 네이버 API 제약: from~to 최대 24시간
 */
async function fetchOrdersForWindow(
  token: string,
  from: Date,
  to: Date,
  statuses: string,
): Promise<WindowResult> {
  const results: ProductOrderDetail[] = [];
  const awaitingAddress: AwaitingAddressOrder[] = [];
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      productOrderStatuses: statuses,
      page: String(page),
      size: "300",
    });

    const response = await fetchWithRetry(
      `${BASE_URL}/pay-order/seller/product-orders?${params}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    const body = await response.text();

    if (!response.ok) {
      throw new Error(
        `조건형 주문 조회 실패 (${response.status}): ${body.slice(0, 500)}`,
      );
    }

    const json = JSON.parse(body);

    // 데이터 없는 응답 (data 필드 없거나 contents 비어있음)
    if (!json.data?.contents?.length) {
      break;
    }

    const parsed = conditionalOrdersResponseSchema.parse(json);
    const split = splitByShippingAddress(
      parsed.data.contents.map((c) => c.content),
    );

    if (split.awaitingAddress.length > 0) {
      console.warn(
        `[naver/orders] 배송지 미입력(선물 수령 대기 추정) ${split.awaitingAddress.length}건 (page=${page})`,
      );
    }

    results.push(...split.orders);
    awaitingAddress.push(...split.awaitingAddress);

    hasNext = parsed.data.pagination.hasNext;
    page++;

    // 다음 페이지 요청 시 Rate limit 방지
    if (hasNext) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return { orders: results, awaitingAddress };
}

/**
 * 발송대기 주문 전체 조회
 *
 * 조건형 API는 from~to 최대 24시간 제약이 있어,
 * LOOKBACK_DAYS 기간을 하루씩 나눠서 스캔한다.
 * productOrderStatuses=PAYED (결제완료 = 배송준비 상태)
 *
 * 배송지가 아직 없는 주문은 예약 대상에서 빼되 버리지 않고 `awaitingAddress`로
 * 함께 돌려준다 — 판매자가 "선물 수령 대기 중인 주문이 있다"는 걸 알아야 한다.
 */
export async function fetchPendingOrders(): Promise<WindowResult> {
  const token = await getAccessToken();
  const now = new Date();
  const results: ProductOrderDetail[] = [];
  const awaitingAddress: AwaitingAddressOrder[] = [];
  const seenIds = new Set<string>();

  for (let daysBack = 0; daysBack < LOOKBACK_DAYS; daysBack++) {
    const from = new Date(now.getTime() - (daysBack + 1) * DAY_MS);
    const to = new Date(now.getTime() - daysBack * DAY_MS);

    const window = await fetchOrdersForWindow(token, from, to, "PAYED");

    // 중복 제거 (윈도우 경계에서 같은 주문이 두 번 나올 수 있음)
    for (const order of window.orders) {
      if (!seenIds.has(order.productOrderId)) {
        seenIds.add(order.productOrderId);
        results.push(order);
      }
    }

    for (const pending of window.awaitingAddress) {
      if (!seenIds.has(pending.productOrderId)) {
        seenIds.add(pending.productOrderId);
        awaitingAddress.push(pending);
      }
    }

    // Rate limit 방지 (일별 요청 간 간격)
    if (daysBack < LOOKBACK_DAYS - 1) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  return { orders: results, awaitingAddress };
}

export interface DeliveryInfo {
  status: "delivering" | "delivered";
  pickupDate: string | null;
}

/** `/product-orders/query`가 한 번에 받는 productOrderId 상한 */
const QUERY_CHUNK = 300;

/**
 * 상품주문 ID 목록의 "발송 관점 상태" 조회.
 *
 * `fetchDeliveryStatuses`가 배송 추적용으로 DELIVERING/DELIVERED만 뽑는 것과 달리,
 * 여기서는 발송 여부 판정에 필요한 원문 상태(productOrderStatus)와 운송장·발송일을
 * 그대로 돌려준다. 판정 자체는 `resolveNaverGroupDispatch`가 한다.
 */
export async function fetchProductOrderStates(
  productOrderIds: string[],
): Promise<Map<string, NaverItemState>> {
  const result = new Map<string, NaverItemState>();
  if (productOrderIds.length === 0) return result;

  const token = await getAccessToken();

  for (let i = 0; i < productOrderIds.length; i += QUERY_CHUNK) {
    const chunk = productOrderIds.slice(i, i + QUERY_CHUNK);
    const response = await fetchWithRetry(
      `${BASE_URL}/pay-order/seller/product-orders/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ productOrderIds: chunk }),
      },
    );

    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `주문 상세 조회 실패 (${response.status}): ${body.slice(0, 500)}`,
      );
    }

    const items = JSON.parse(body).data;
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      const productOrderId = item.productOrder?.productOrderId;
      if (!productOrderId) continue;
      const delivery = item.delivery ?? {};

      result.set(productOrderId, {
        productOrderStatus: item.productOrder?.productOrderStatus ?? "",
        trackingNumber: delivery.trackingNumber ?? null,
        // sendDate(발송일)가 정확한 값. 없으면 집화/배송완료 시각으로 대체한다.
        dispatchedAt:
          delivery.sendDate ??
          delivery.pickupDate ??
          delivery.deliveredDate ??
          null,
      });
    }
  }

  return result;
}

/**
 * 상품주문 ID 목록으로 배송 상태 조회 (POST /query)
 *
 * 조건형 API(24시간 윈도우 제약)와 달리 productOrderId로 직접 조회하므로
 * 시간 범위에 관계없이 정확한 결과를 반환한다.
 * 응답의 delivery 객체에서 deliveryStatus와 pickupDate를 추출.
 */
export async function fetchDeliveryStatuses(
  productOrderIds: string[],
): Promise<Map<string, DeliveryInfo>> {
  if (productOrderIds.length === 0) return new Map();

  const token = await getAccessToken();
  const result = new Map<string, DeliveryInfo>();

  const response = await fetchWithRetry(
    `${BASE_URL}/pay-order/seller/product-orders/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ productOrderIds }),
    },
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `주문 상세 조회 실패 (${response.status}): ${body.slice(0, 500)}`,
    );
  }

  const json = JSON.parse(body);
  const items = json.data;

  if (!Array.isArray(items)) return result;

  for (const item of items) {
    const productOrderId = item.productOrder?.productOrderId;
    const delivery = item.delivery;

    if (!productOrderId || !delivery) continue;

    const status = delivery.deliveryStatus;
    if (status === "DELIVERING") {
      result.set(productOrderId, {
        status: "delivering",
        pickupDate: delivery.pickupDate ?? null,
      });
    } else if (status === "DELIVERED") {
      result.set(productOrderId, {
        status: "delivered",
        pickupDate: delivery.pickupDate ?? null,
      });
    }
  }

  return result;
}
