import { getAccessToken } from "./auth";
import {
  conditionalOrdersResponseSchema,
  toProductOrderDetail,
} from "./types";
import type { ProductOrderDetail } from "./types";

const BASE_URL = "https://api.commerce.naver.com/external/v1";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const LOOKBACK_DAYS = 7; // 기본 조회 기간 (일)
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rate limit 대응 지수 백오프 fetch 래퍼
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit
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
): Promise<ProductOrderDetail[]> {
  const results: ProductOrderDetail[] = [];
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
    const orders = parsed.data.contents.map((c) =>
      toProductOrderDetail(c.content),
    );
    results.push(...orders);

    hasNext = parsed.data.pagination.hasNext;
    page++;

    // 다음 페이지 요청 시 Rate limit 방지
    if (hasNext) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return results;
}

/**
 * 발송대기 주문 전체 조회
 *
 * 조건형 API는 from~to 최대 24시간 제약이 있어,
 * LOOKBACK_DAYS 기간을 하루씩 나눠서 스캔한다.
 * productOrderStatuses=PAYED (결제완료 = 배송준비 상태)
 */
export async function fetchPendingOrders(): Promise<ProductOrderDetail[]> {
  const token = await getAccessToken();
  const now = new Date();
  const results: ProductOrderDetail[] = [];
  const seenIds = new Set<string>();

  for (let daysBack = 0; daysBack < LOOKBACK_DAYS; daysBack++) {
    const from = new Date(now.getTime() - (daysBack + 1) * DAY_MS);
    const to = new Date(now.getTime() - daysBack * DAY_MS);

    const orders = await fetchOrdersForWindow(token, from, to, "PAYED");

    for (const order of orders) {
      // 중복 제거 (윈도우 경계에서 같은 주문이 두 번 나올 수 있음)
      if (!seenIds.has(order.productOrderId)) {
        seenIds.add(order.productOrderId);
        results.push(order);
      }
    }

    // Rate limit 방지 (일별 요청 간 간격)
    if (daysBack < LOOKBACK_DAYS - 1) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  return results;
}

export interface DeliveryInfo {
  status: "delivering" | "delivered";
  pickupDate: string | null;
}

/**
 * 상품주문 ID 목록으로 배송 상태 조회 (POST /query)
 *
 * 조건형 API(24시간 윈도우 제약)와 달리 productOrderId로 직접 조회하므로
 * 시간 범위에 관계없이 정확한 결과를 반환한다.
 * 응답의 delivery 객체에서 deliveryStatus와 pickupDate를 추출.
 */
export async function fetchDeliveryStatuses(
  productOrderIds: string[]
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
    }
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `주문 상세 조회 실패 (${response.status}): ${body.slice(0, 500)}`
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
