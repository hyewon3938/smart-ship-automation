import { getAccessToken } from "./auth";
import {
  lastChangedStatusesResponseSchema,
  productOrdersQueryResponseSchema,
} from "./types";
import type { ProductOrderDetail } from "./types";

const BASE_URL = "https://api.commerce.naver.com/external/v1";
const MAX_BATCH_SIZE = 300; // 네이버 API 배치 최대 크기
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

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
 * Step 1: 변경 상품 주문 ID 목록 조회
 * 최근 24시간 내 PAYED 상태로 변경된 주문을 가져온다
 */
export async function fetchChangedProductOrderIds(): Promise<
  { productOrderId: string; orderId: string }[]
> {
  const token = await getAccessToken();

  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    lastChangedFrom: from.toISOString(),
    lastChangedType: "PAYED",
  });

  const response = await fetchWithRetry(
    `${BASE_URL}/pay-order/seller/product-orders/last-changed-statuses?${params}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`변경 주문 조회 실패 (${response.status}): ${body}`);
  }

  const json = await response.json();
  const parsed = lastChangedStatusesResponseSchema.parse(json);

  return parsed.data.lastChangeStatuses.map((s) => ({
    productOrderId: s.productOrderId,
    orderId: s.orderId,
  }));
}

/**
 * Step 2: 상품 주문 상세 조회 (배치)
 * productOrderId 목록으로 수령자 정보를 포함한 상세 데이터 조회
 */
export async function fetchProductOrderDetails(
  productOrderIds: string[]
): Promise<ProductOrderDetail[]> {
  if (productOrderIds.length === 0) return [];

  const token = await getAccessToken();
  const results: ProductOrderDetail[] = [];

  // MAX_BATCH_SIZE 단위로 나눠서 요청
  for (let i = 0; i < productOrderIds.length; i += MAX_BATCH_SIZE) {
    const batch = productOrderIds.slice(i, i + MAX_BATCH_SIZE);

    const response = await fetchWithRetry(
      `${BASE_URL}/pay-order/seller/product-orders/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ productOrderIds: batch }),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`주문 상세 조회 실패 (${response.status}): ${body}`);
    }

    const json = await response.json();
    const parsed = productOrdersQueryResponseSchema.parse(json);

    results.push(...parsed.data.map((d) => d.productOrder));
  }

  return results;
}

/**
 * 발송대기 주문 전체 조회 (Step 1 + Step 2 조합)
 */
export async function fetchPendingOrders(): Promise<ProductOrderDetail[]> {
  const changedOrders = await fetchChangedProductOrderIds();
  const productOrderIds = changedOrders.map((o) => o.productOrderId);
  return fetchProductOrderDetails(productOrderIds);
}
